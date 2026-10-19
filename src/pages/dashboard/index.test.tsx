import { fireEvent, waitFor, within } from '@testing-library/react'
import { expectNoTexErrors } from '@/test/katex'
import { ROUTES, QUESTIONS, SIX_CONDITIONS } from './data'
import { galleryPresets } from './sections/Gallery'
import { TOC } from './sections/Hero'
import { DASH_SYMBOLS } from './sections/Symbols'
import { DASH_CHARTS, DASH_SYSTEM_FOCUS } from './diagrams'
import { precedes, plainText, renderPage, texIn } from './indexTestUtils'
import { summarizeErrata } from './summaries'
import { systemMapModel } from '@/components'

import { plotlyMock as P } from '@/test/mocks/plotly'
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

// vi.fn() 會把每次呼叫的引數整份留在 mock.calls 裡；Plot 每次都把整張圖的資料（上千點的陣列）交給 P.react，所以每個測試之後清掉呼叫紀錄
afterEach(() => {
  P.react.mockClear()
  P.purge.mockClear()
  P.toImage.mockClear()
  P.downloadImage.mockClear()
})

// 整頁約 5 萬個 DOM 節點（KaTeX），jsdom 首次渲染需數秒；其他 agent 同時跑測試時更慢
vi.setConfig({ testTimeout: 60_000 })

/** R12：雙參數模型的交叉相關假設（體檢的提醒、指標表、eigen-mode 表旁都用同一個寫法） */
const CROSS_TEX = String.raw`E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}`


/**
 * 符號表在頁末（docs/teaching-style.md §5）：全頁只有一張，包在 id="symbols" 裡，是頁面的最後一個區塊（在頁尾說明之後）；
 * 頁首（系統地圖那一節）只留一行按鈕。整頁約 2 萬個 DOM 節點，再多渲染一次會讓 jsdom 記憶體吃緊，所以和 smoke test 共用同一次渲染。
 */
function expectSymbolsAtEnd(container: HTMLElement) {
  const page = container.querySelector('.dash') as HTMLElement
  const symbols = container.querySelector('#symbols') as HTMLElement
  expect(symbols).not.toBeNull()
  expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
  expect(symbols.querySelectorAll('.c-symbols tbody tr')).toHaveLength(DASH_SYMBOLS.length)
  expect(page.lastElementChild).toBe(symbols)
  expect(symbols.lastElementChild?.classList.contains('c-symbols')).toBe(true)
  expect(precedes(container.querySelector('#dash-recap'), symbols)).toBe(true)
  expect(precedes(container.querySelector('.dash-footnote'), symbols)).toBe(true)
  expect(symbols.querySelector('h2')?.textContent).toBe('本頁符號表')
  // 「一條方程式」那一節裡不再有符號表
  expect(container.querySelector('#dash-spine .c-symbols')).toBeNull()
  // 頁首只留一行「本頁符號表在最後 ↓」：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），在第一個內容區塊（系統地圖）裡
  const jump = container.querySelector('.dash-symbols-jump button') as HTMLButtonElement
  expect(jump.textContent).toBe('本頁符號表在最後 ↓')
  expect(container.querySelectorAll('.dash-symbols-jump')).toHaveLength(1)
  expect(jump.closest('a')).toBeNull()
  expect(container.querySelector('a[href*="#symbols"]')).toBeNull()
  expect(jump.closest('#dash-map')).toBeTruthy()
  expect(precedes(jump, container.querySelector('#dash-spine'))).toBe(true)
  // 按下去捲到頁末的 #symbols；符號表旁的「回到頁首」捲回頁首（jsdom 沒有 scrollIntoView，這裡裝一個假的）
  const down = vi.fn()
  const up = vi.fn()
  symbols.scrollIntoView = down
  ;(container.querySelector('#dash-title') as HTMLElement).scrollIntoView = up
  fireEvent.click(jump)
  expect(down).toHaveBeenCalledTimes(1)
  fireEvent.click(within(symbols).getByRole('button', { name: /回到頁首/ }))
  expect(up).toHaveBeenCalledTimes(1)
}

/** 方塊圖（docs/teaching-style.md §8）：四張（系統地圖＋本頁的三張）依序出現，有圖說與替代文字，放在對應的文字說明之後、推導之前。 */
function expectDiagrams(container: HTMLElement) {
  const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
  expect(figs).toHaveLength(1 + DASH_CHARTS.length)
  for (const f of figs) {
    const cap = f.querySelector('figcaption')?.textContent ?? ''
    expect(cap.length, cap).toBeGreaterThan(20)
    expect(cap, cap).not.toMatch(/\$/)
    expect((f.getAttribute('aria-label') ?? '').length).toBeGreaterThan(20)
  }
  const [map, flowFig, loopFig, eqFig] = figs
  // 第一張是共用的系統地圖：手排的 SVG（figure.c-sysmap），不是 Mermaid；首頁談整個系統，所以所有方塊都是主角（is-focus）
  expect(map.classList.contains('c-sysmap')).toBe(true)
  const expected = systemMapModel(DASH_SYSTEM_FOCUS).blocks
  const drawn = Array.from(map.querySelectorAll('g.c-sysmap-block'))
  expect(drawn.map((b) => b.getAttribute('data-block')).sort()).toEqual(expected.map((b) => b.id).sort())
  expect(map.querySelectorAll('g.c-sysmap-block.is-focus')).toHaveLength(expected.length)
  expect(drawn.every((b) => b.getAttribute('data-focus') === 'true')).toBe(true)
  // 另外三張是 Mermaid（這個測試把 mermaid mock 掉了，所以只有外框與圖說）：外框裡沒有 .c-mermaid-svg 是正常的
  for (const f of [flowFig, loopFig, eqFig]) expect(f.classList.contains('c-sysmap'), f.getAttribute('aria-label') ?? '').toBe(false)
  // 順序：系統地圖（#dash-map）→ 六個條件的檢查流程（#dash-thesis）→ 條件在迴路上的位置、block 方程式（#dash-spine）
  expect((container.querySelector('#dash-map') as HTMLElement).contains(map)).toBe(true)
  expect((container.querySelector('#dash-thesis') as HTMLElement).contains(flowFig)).toBe(true)
  const spine = container.querySelector('#dash-spine') as HTMLElement
  expect(spine.contains(loopFig) && spine.contains(eqFig)).toBe(true)
  expect(map.getAttribute('aria-label')).toContain('系統方塊圖')
  expect(flowFig.getAttribute('aria-label')).toContain('六個條件的檢查流程')
  expect(loopFig.getAttribute('aria-label')).toContain('六個條件分別標在')
  expect(eqFig.getAttribute('aria-label')).toContain('線性化 block 方程式')
  // 圖在它的推導之前：檢查流程在六張條件卡片之前；位置圖與 block 方程式在第一個逐步推導（details）之前
  expect(precedes(flowFig, container.querySelector('#dash-cond-identifiability'))).toBe(true)
  expect(precedes(loopFig, eqFig) && precedes(eqFig, spine.querySelector('details.dash-details'))).toBe(true)
  // 檢查流程與 block 方程式各有「怎麼讀」導讀，並用 KaTeX 把圖上的名字對回公式
  for (const f of [flowFig, eqFig]) expect(f.closest('.dash-diagram')?.querySelector('.dash-diagram-walk .katex'), f.getAttribute('aria-label') ?? '').toBeTruthy()
  expectReferenceSideDtc(container, map, loopFig)
}

/**
 * 架構（docs/assumptions.md §2a）：DTC 在 reference 的輸入端、回授路徑上只有 divider；LMS 校正迴路的輸入是 PD 的輸出；
 * DTC 的作用寫成「補償量」（從基準延遲 T_0 往回扣），PD 量的是 e = t_ref′ − t_fb = (a − w)·x + v。
 */
function expectReferenceSideDtc(container: HTMLElement, map: HTMLElement, loopFig: HTMLElement) {
  const sec = container.querySelector('#dash-map') as HTMLElement
  const text = plainText(sec).replace(/\s+/g, ' ')
  // 系統地圖下面的三點說明：主迴路的順序、補償的接法、LMS 的輸入
  expect(text).toContain('reference → DTC → phase detector → loop filter → VCO')
  expect(text).toContain('DTC 在 reference 的輸入端，回授路徑上只有 divider')
  expect(text).toContain('gain correction → reference 端的 DTC')
  expect(text).toContain('只能延遲、不能提前')
  expect(text).toContain('補償量')
  // 「提前」一定和基準延遲 T_0 一起講（DTC 不能產生負的延遲）；feedback edge 早到的量是鋸齒 a·x[n]，x ∈ [0, 1)
  expect(text).toContain('和「一律延遲')
  expect(text).toContain('去對齊早到的 feedback edge')
  expect(text).toContain('補償不足')
  expect(text).toContain('reference 還是太晚，誤差為正')
  // 標題旁的小字與圖下的註記不能互相矛盾：這張圖不是規格 §4 原圖的接法
  expect(plainText(sec.querySelector('h2') as Element)).toContain('DTC 改接在 reference 輸入端')
  expect(plainText(sec.querySelector('h2') as Element)).not.toContain('規格 §4 的概念架構')
  expect(text).toContain('本站一律照 reference 端 input DTC 的接法畫，上面這張圖也是')
  // q 的正負號：補償後的 reference edge 比 feedback edge 晚 ⇒ q = +1（LMS 的更新 w ← w + μ·q·x 把補償量加大）
  expect(text).toMatch(/reference edge 比 feedback edge 晚（.*）還是早（/)
  expect(text).toContain('comparator 取的是 PD 的輸出')
  expect(text).toContain('也就是送進 loop filter 的同一個訊號')
  // 舊接法的說法（把 DTC 放在回授那一側、說 DTC 產生相反的延遲、LMS 的輸入只寫 phase error）不再出現
  expect(text).not.toMatch(/divider → DTC|DTC → 回到 phase detector|產生相反的延遲|phase error → 1-bit comparator/)
  const tex = texIn(sec)
  expect(tex).toContain(String.raw`\tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]`)
  expect(tex).toContain(String.raw`e[n]=t_{\mathrm{ref}}'[n]-t_{\mathrm{fb}}[n]=(a-w)\,x[n]+v[n]`)
  expect(tex).toContain(String.raw`0\le x[n]<1`)
  expect(tex.indexOf('q[n]=+1')).toBeGreaterThan(-1)
  expect(tex.indexOf('q[n]=+1')).toBeLessThan(tex.indexOf('q[n]=-1')) // 先「晚」（+1）後「早」（−1），和文字的順序一致
  // 系統地圖與條件地圖的圖說、替代文字都說明 LMS 的輸入取自 PD 的輸出
  expect(plainText(map.querySelector('figcaption') as Element)).toContain('LMS 校正迴路的輸入是 phase detector 的輸出')
  expect(map.getAttribute('aria-label')).toContain('DTC 在 reference 輸入端')
  expect(loopFig.getAttribute('aria-label')).toContain('reference 端的 DTC')
  expect(loopFig.getAttribute('aria-label')).toContain('取 PD 輸出的正負號')
  expect(plainText(loopFig.querySelector('figcaption') as Element)).toContain('comparator 取的是 PD 的輸出')
  // 推導 1（comparator 的輸入）與推導 4（DTC-referred timing error）的說明用同一套講法
  const spine = plainText(container.querySelector('#dash-spine') as HTMLElement)
  expect(spine).toContain('Comparator 取的是 PD 的輸出')
  expect(spine).toContain('Reference 端的 DTC 實際給的補償量是')
  expect(spine).not.toMatch(/DTC 實際給的延遲/)
  // δt = (w − a)·x 是「多補償的時間」，和 PD 量到的殘餘 (a − w)·x 差一個負號（勘誤 E33）——頁面要明講，讀者才不會以為兩處的正負號互相矛盾
  expect(spine).toMatch(/多補償為正）。PD 量到的殘餘\s*正好是它的負號（勘誤 E33）/)
  // 頁末符號表：δt 的定義改用補償量；另外列出 τ_DTC 與 t_ref′、t_fb
  const symbols = container.querySelector('#symbols') as HTMLElement
  expect(plainText(symbols)).not.toMatch(/DTC 實際延遲與理想延遲的差/)
  expect(texIn(symbols)).toContain(String.raw`\tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]`)
  expect(texIn(symbols)).toContain(String.raw`t_{\mathrm{ref}}'[n],\ t_{\mathrm{fb}}[n]`)
}

/**
 * R02：95% 收斂那一列——d = 0 時是封閉式；有 commit 延遲時是照平均遞迴逐 block 數出來的（和上方的軌跡圖同一條遞迴），
 * 並在 eigen-mode 表下方（Engineer 以上）就地用重根的例子說明。和「預設六個條件全部通過」共用同一次渲染，看完把參數改回預設。
 */
async function expectSettlingRow(check: HTMLElement) {
  const row = () => Array.from(check.querySelectorAll('.c-metric-table tbody tr')).find((tr) => (tr.textContent ?? '').includes('95% 收斂（最慢 mode）')) as HTMLElement
  const value = () => row().querySelector('td.num')?.textContent
  // 預設 d = 0：37 個 block，封閉式
  expect(value()).toBe('37')
  expect(texIn(row())).toContain(String.raw`\lceil\ln0.05/\ln|1-g_i|\rceil`)
  expect(plainText(check)).not.toContain('是重根')
  // d = 1、μ 調到 g = 0.25（μ = 0.25/K_q = 31.33 fs）：重根 z = 0.5，7 個 block；只看 max|z| 是 5
  const dInput = check.querySelector('input[aria-label="d（係數 commit 延遲）"]') as HTMLInputElement
  const muInput = check.querySelector('input[aria-label="mu（學習率）"]') as HTMLInputElement
  fireEvent.change(dInput, { target: { value: '1' } })
  fireEvent.change(muInput, { target: { value: String((0.25 * 100) / Math.sqrt(2 / Math.PI)) } })
  await waitFor(() => expect(texIn(row()).some((t) => t.includes(String.raw`\delta_{k+1}=\delta_k-g_i\,\delta_{k-d}`))).toBe(true))
  expect(value()).toBe('7')
  expect(texIn(row()).some((t) => t.includes(String.raw`\lceil\ln0.05/\ln\max|z|\rceil=5`))).toBe(true)
  // 就地說明與重根的例子：0.109、0.0625、0.0352 ⇒ 7，而 ⌈ln 0.05 / ln 0.5⌉ = 5
  expect(plainText(check)).toContain('是重根')
  const tex = texIn(check)
  for (const need of ['0.109', '0.0625', '0.0352', '7', String.raw`\lceil\ln0.05/\ln0.5\rceil=5`]) expect(tex, need).toContain(need)
  // 改回預設
  fireEvent.change(dInput, { target: { value: '0' } })
  fireEvent.change(muInput, { target: { value: '10' } })
  await waitFor(() => expect(value()).toBe('37'))
  expect(check.querySelectorAll('.dash-check-table .dash-state-ok').length).toBe(6)
}

describe('DashboardPage（jsdom smoke）', () => {
  it('渲染不出錯：Hero、從這裡開始（/ch/00）、六個條件、三條路線、15 題、模式、勘誤；四張方塊圖與頁末的符號表', async () => {
    const { container } = renderPage()
    const hero = container.querySelector('.dash-hero') as HTMLElement
    expect(within(hero).getByRole('heading', { level: 1, name: /LMS × Fractional-N PLL Calibration Lab/ })).toBeTruthy()
    const start = within(hero).getByRole('link', { name: /開始第一課/ })
    expect(start.getAttribute('href')).toBe('/ch/00')
    // 手算表：w1 = 1.8、w2 = 2.28（由 runScalarLms 算出）
    expect(container.querySelector('.dash-start')?.textContent).toMatch(/1\.8/)
    expect(container.querySelector('.dash-start')?.textContent).toMatch(/2\.28/)
    expect(container.querySelectorAll('.dash-cond-card')).toHaveLength(SIX_CONDITIONS.length)
    expect(container.querySelectorAll('.dash-route')).toHaveLength(ROUTES.length)
    expect(container.querySelectorAll('.dash-q')).toHaveLength(QUESTIONS.length)
    expect(container.querySelectorAll('.dash-mode')).toHaveLength(3)
    // 段落順序（入口頁：先說學完能做什麼、從哪開始、怎麼選模式，再進研究級的六條件區）；Hero 的目錄照同一個順序
    const ORDER = ['dash-outcomes', 'dash-map', 'dash-routes', 'dash-modes', 'dash-thesis', 'dash-spine', 'dash-check', 'dash-chapters', 'dash-gallery', 'dash-questions', 'dash-verify', 'dash-recap', 'symbols']
    expect(TOC.map((t) => t.id)).toEqual(ORDER)
    const sections = ORDER.map((id) => container.querySelector(`#${id}`))
    for (let i = 0; i < sections.length; i++) {
      expect(sections[i], ORDER[i]).not.toBeNull()
      if (i > 0) expect(precedes(sections[i - 1], sections[i]), `${ORDER[i - 1]} → ${ORDER[i]}`).toBe(true)
    }
    expect(precedes(hero, sections[0])).toBe(true)
    expect(Array.from(container.querySelectorAll('.dash-toc button'), (b) => b.textContent)).toEqual(TOC.map((t) => t.label))
    // Engineer：沒有 Beginner 的收合卡片，六個條件直接展開
    expect(container.querySelector('details.dash-fold')).toBeNull()
    // 學完你能做什麼：三張卡片（Part A / B / C），各兩句、每句連到教那件事的章節；數學以 KaTeX 排版（μ、K_q、N、σ_w）
    const outcomes = container.querySelector('#dash-outcomes') as HTMLElement
    const cards = Array.from(outcomes.querySelectorAll('.dash-outcome')) as HTMLElement[]
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['Part A｜LMS 數學基礎', 'Part B｜PLL 校正實作', 'Part C｜誤差與晶片限制'])
    expect(cards.map((c) => Array.from(c.querySelectorAll('a'), (a) => a.getAttribute('href')))).toEqual([
      ['/ch/00', '/ch/03'],
      ['/ch/05', '/ch/06'],
      ['/ch/12', '/ch/13'],
    ])
    for (const c of cards) expect(c.querySelectorAll('li')).toHaveLength(2)
    const outcomeText = plainText(outcomes)
    for (const need of ['手算 LMS 兩步', '會不會發散', '極性反過來', 'spur', '6-bit', 'dither']) expect(outcomeText, need).toContain(need)
    const outcomeTex = texIn(outcomes)
    for (const need of [String.raw`\mu`, 'K_q', 'N', String.raw`\sigma_w`]) expect(outcomeTex, need).toContain(need)
    expect(outcomeText).not.toMatch(/\$|undefined|NaN/)
    // 勘誤數與 errata.json 一致，並連到 /verification
    const e = summarizeErrata()
    expect(within(container.querySelector('#dash-verify') as HTMLElement).getByText(`規格勘誤 ${e.total} 項`)).toBeTruthy()
    expect(container.querySelectorAll('a[href^="/verification"]').length).toBeGreaterThan(3)
    // 「勘誤 Exx」深連結到驗證頁的那一條；T-id 深連結到驗收列
    expect(container.querySelector('a.dash-erratum[href="/verification?e=E01"]')).toBeTruthy()
    expect(container.querySelector('#dash-verify a[href="/verification?t=T13"]')).toBeTruthy()
    // 條件在迴路上的位置圖（Mermaid）與六個條件的圖例
    const spine = container.querySelector('#dash-spine') as HTMLElement
    expect(spine.querySelector('.c-mermaid')).toBeTruthy()
    expect(spine.querySelectorAll('.dash-legend-table tbody tr')).toHaveLength(6)
    // 12 個必備實驗：由 preset 註冊表彙整，連結帶 ?preset=
    const gal = container.querySelector('#dash-gallery') as HTMLElement
    const presets = galleryPresets()
    expect(gal.querySelectorAll('.dash-gal-card')).toHaveLength(presets.length)
    if (presets.length > 0) expect(gal.querySelector('.dash-gal-link')?.getAttribute('href')).toBe(`${presets[0].page}?preset=${presets[0].id}`)
    // R13：六個條件要「逐一檢查」，但不是互相獨立（首段、流程圖導讀、本頁必記）
    const thesisText = container.querySelector('#dash-thesis')?.textContent ?? ''
    expect(thesisText).toContain('逐一檢查')
    expect(thesisText).toContain('不是互相獨立')
    expect(thesisText).toContain('前五個都通過，仍可能在第六個失敗') // 真正成立的單向敘述保留
    expect(thesisText).not.toContain('彼此獨立：滿足其中五個')
    expect(thesisText).not.toContain('它們互相獨立')
    const recapText = container.querySelector('#dash-recap')?.textContent ?? ''
    expect(recapText).toContain('不是互相獨立')
    expect(recapText).not.toContain('六個條件互相獨立：')
    // R14：卡片 6 是「殘餘誤差在預算內」（DTC-referred），不再用「真正改善 PLL 輸出」當名稱；Hero 的膠囊與體檢表同名
    const sysCard = container.querySelector('#dash-cond-system') as HTMLElement
    expect(sysCard.querySelector('.dash-cond-title')?.textContent).toContain('殘餘誤差在預算內')
    expect(plainText(sysCard)).toContain('DTC-referred')
    expect(plainText(sysCard)).toContain('不和校正前比')
    expect(plainText(sysCard)).not.toMatch(/改善|變好/)
    expect(texIn(sysCard)).toContain(String.raw`\begin{gathered}\sigma_{\delta t}=\sqrt{P_x\,(\Delta w^2+\sigma_w^2)}\le\sigma_{\delta t,\max}\\[2pt]\mathrm{Spur}\approx20\log_{10}\!\left(\pi f_{\mathrm{out}}|T|A_t\right)\le\mathrm{Spur}_{\max}\end{gathered}`)
    const pills = Array.from(container.querySelectorAll('.dash-hero .dash-pill'), (b) => b.textContent ?? '')
    expect(pills).toHaveLength(6)
    expect(pills[5]).toContain('殘餘誤差在預算內')
    const rows = Array.from(container.querySelectorAll('#dash-check .dash-check-table tbody tr td:first-child'), (td) => (td.textContent ?? '').trim())
    expect(rows[5]).toBe('6. 殘餘誤差在預算內')
    // 首段保留規格的主旨句，並緊接著說明本頁實際檢查的是比較窄的「在預算內」
    expect(thesisText).toContain('真正改善 PLL output jitter / spur')
    expect(thesisText).toContain('這比「真正改善輸出」窄')
    // 卡片 3 的判據排成兩行（一行比 1280px 桌機上的卡片寬，結尾的 (g = μK_qC) 要捲動才看得到）
    expect(texIn(container.querySelector('#dash-cond-stability .dash-cond-tex'))).toEqual([
      String.raw`\begin{gathered}p=1-\mu K_q C\\[2pt]0<g<2\sin\frac{\pi}{4d+2}\quad(g=\mu K_qC)\end{gathered}`,
    ])
    // 本頁必記第 1 點：句尾的公式和句號綁在一起（.dash-glue），句號不會單獨掉到下一行
    const point1 = container.querySelector('#dash-recap .c-recap-points li') as HTMLElement
    const tail = point1.lastElementChild as HTMLElement
    expect(tail.className).toBe('dash-glue')
    expect(texIn(tail)).toEqual(['C>0'])
    expect(plainText(tail)).toBe('。')
    expect(point1.lastChild).toBe(tail)
    // Hero 的手算表下方：「w_n → a。」同樣綁住
    const heroGlue = Array.from(container.querySelectorAll('.dash-start .dash-glue')).find((g) => texIn(g).includes(String.raw`w_n\to a`)) as HTMLElement
    expect(plainText(heroGlue)).toBe('。')
    // 本頁必記第 4 點：快與安靜的取捨要帶條件（小步長；沒有 commit 延遲時分界在 g = 1）
    const point4 = container.querySelectorAll('#dash-recap .c-recap-points li')[3] as HTMLElement
    expect(plainText(point4)).toContain('快與安靜要取捨')
    expect(plainText(point4)).toContain('小步長')
    expect(texIn(point4)).toContain(String.raw`g\ll1`)
    expect(texIn(point4)).toContain('g=1')
    // 「同時校正第二個參數」開關的說明是一整句（一個元素）：不會被 flex 拆成「文字／ρ／文字」三段
    const toggleMeta = container.querySelector('#dash-check .c-toggle .c-param-meta') as HTMLElement
    expect(toggleMeta.children).toHaveLength(1)
    expect(toggleMeta.childNodes).toHaveLength(1)
    expect(plainText(toggleMeta)).toContain('零延遲相關係數')
    expect(plainText(toggleMeta)).toContain('的 regressor 當抽象例子')
    expect(texIn(toggleMeta)).toEqual([String.raw`\rho`])
    // 方塊圖與頁末的符號表（兩個 helper 見上）
    expectDiagrams(container)
    expectSymbolsAtEnd(container)
    // KaTeX 有渲染（數學一律 LaTeX）
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(50)
    // 圖表呼叫 Plotly
    await waitFor(() => expect(P.react).toHaveBeenCalled())
  })

  it('符號表的內容：每個符號與單位的 TeX 都能解析，符號不重複（React key）', async () => {
    const katex = (await import('katex')).default
    for (const r of DASH_SYMBOLS) {
      expect(() => katex.renderToString(r.symbol, { throwOnError: true, strict: 'ignore' }), r.symbol).not.toThrow()
      if (r.unit) expect(() => katex.renderToString(r.unit as string, { throwOnError: true, strict: 'ignore' }), r.unit).not.toThrow()
    }
    expect(new Set(DASH_SYMBOLS.map((r) => r.symbol)).size).toBe(DASH_SYMBOLS.length)
  })

  it('路線步驟由 registry 組成，每一步都是可點擊的章節連結；數學路線的 STEP 1 是 Ch00 入門課', () => {
    const { container } = renderPage()
    const route = container.querySelector('.dash-route') as HTMLElement
    const links = within(route).getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(ROUTES[0].steps.length)
    expect(links[0].getAttribute('href')).toBe('/ch/00')
    expect(links[1].getAttribute('href')).toBe('/ch/01')
    const step1 = route.querySelector('.dash-step-card') as HTMLElement
    expect(step1.querySelector('.dash-step-n')?.textContent).toBe('STEP 1')
    expect(step1.querySelector('.dash-step-label')?.textContent).toBe('Black Box')
    expect(step1.querySelector('.dash-step-meta')?.textContent).toContain('Ch00')
    // 「第一次來建議先走數學路線的前三步」：前三步就是 Ch00 → Ch01 → Ch02
    expect(Array.from(route.querySelectorAll('.dash-step-card'), (a) => a.getAttribute('href')).slice(0, 3)).toEqual(['/ch/00', '/ch/01', '/ch/02'])
    expect(container.querySelector('#dash-routes')?.textContent).toContain('先走數學路線的前三步')
  })

  it('Beginner：六個條件／一條方程式／動手體檢收成一張卡片，展開才渲染；頁內跳轉與「載入反例」會先展開再捲；參數在收合後保留', async () => {
    const { container } = renderPage('beginner')
    const fold = () => container.querySelector('details.dash-fold') as HTMLDetailsElement
    const summary = () => fold().querySelector('summary') as HTMLElement
    // 收合：卡片在「三種學習模式」之後、「章節地圖」之前，標題照規定寫；裡面的三個段落都還沒渲染
    expect(fold()).not.toBeNull()
    expect(fold().open).toBe(false)
    expect(summary().textContent).toContain('給讀完 Part B 的人：六條件一分鐘體檢（展開）')
    expect(precedes(container.querySelector('#dash-modes'), fold()) && precedes(fold(), container.querySelector('#dash-chapters'))).toBe(true)
    for (const id of ['dash-thesis', 'dash-spine', 'dash-check']) expect(container.querySelector(`#${id}`), id).toBeNull()
    expect(container.querySelectorAll('.dash-cond-card')).toHaveLength(0)
    // Engineer / Research 沒有這張卡片（index.test 的其他測試用 engineer 渲染，直接找得到 #dash-check）
    // Hero 目錄的「動手體檢」：先展開、內容渲染出來之後才捲到 #dash-check（jsdom 沒有 scrollIntoView，這裡記下被捲到的 id）
    const scrolled: string[] = []
    const proto = Element.prototype as Element & { scrollIntoView?: () => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    try {
      const hero = container.querySelector('.dash-hero') as HTMLElement
      fireEvent.click(within(hero).getByRole('button', { name: '動手體檢' }))
      await waitFor(() => expect(container.querySelector('#dash-check')).not.toBeNull())
      expect(fold().open).toBe(true)
      expect(summary().textContent).toContain('（收合）')
      await waitFor(() => expect(scrolled).toEqual(['dash-check']))
      expect(container.querySelectorAll('.dash-cond-card')).toHaveLength(SIX_CONDITIONS.length)
      expect(container.querySelector('#dash-thesis .c-mermaid')).toBeTruthy()
      // 展開後的順序：六個條件 → 一條方程式 → 動手體檢，全部在卡片裡
      expect(precedes(container.querySelector('#dash-thesis'), container.querySelector('#dash-spine'))).toBe(true)
      expect(precedes(container.querySelector('#dash-spine'), container.querySelector('#dash-check'))).toBe(true)
      expect(fold().contains(container.querySelector('#dash-check'))).toBe(true)
      // 「載入反例」（卡片 6）：套用 preset、捲到體檢，燈號變成未通過
      const sysCard = () => container.querySelector('#dash-cond-system') as HTMLElement
      fireEvent.click(sysCard().querySelector('.dash-cond-example') as HTMLButtonElement)
      await waitFor(() => expect(within(sysCard()).getByRole('img', { name: '未通過' })).toBeTruthy())
      expect(scrolled).toEqual(['dash-check', 'dash-check'])
      // 段落最後的「收合」按鈕：內容卸載、捲回卡片；再展開：Case 的參數還在（反例仍然讓卡片 6 未通過）
      // （不用 getByRole 掃整個卡片：體檢裡上千個節點會讓 jsdom 的 getComputedStyle 在某些樣式表上拋錯）
      const endBtn = fold().querySelector('.dash-fold-end button') as HTMLButtonElement
      expect(endBtn.textContent).toContain('收合「六條件一分鐘體檢」')
      fireEvent.click(endBtn)
      await waitFor(() => expect(container.querySelector('#dash-check')).toBeNull())
      expect(fold().open).toBe(false)
      expect(scrolled).toEqual(['dash-check', 'dash-check', 'dash-fold'])
      fireEvent.click(summary())
      await waitFor(() => expect(within(sysCard()).getByRole('img', { name: '未通過' })).toBeTruthy())
      // 收合狀態下按 Hero 的條件膠囊：展開並捲到那張卡片
      fireEvent.click(summary())
      await waitFor(() => expect(container.querySelector('#dash-cond-polarity')).toBeNull())
      fireEvent.click(within(container.querySelector('.dash-hero') as HTMLElement).getByRole('button', { name: /更新方向正確/ }))
      await waitFor(() => expect(scrolled.at(-1)).toBe('dash-cond-polarity'))
      expect(fold().open).toBe(true)
    } finally {
      proto.scrollIntoView = original
    }
  })

  // 注意：整頁有約 2 萬個 DOM 節點（KaTeX 的 HTML + MathML），document 層級的 getByRole / getByLabelText 會非常慢，
  // 因此以下一律先用 querySelector 找到段落，再在段落內查詢。
  it('預設（T13）六個條件全部通過；有 commit 延遲時 95% 收斂逐 block 數；改成 φ = 120° 後極性燈號變成未通過並顯示原因', async () => {
    const { container } = renderPage('engineer')
    const polarityCard = container.querySelector('#dash-cond-polarity') as HTMLElement
    expect(within(polarityCard).getByRole('img', { name: '通過' })).toBeTruthy()
    const check = container.querySelector('#dash-check') as HTMLElement
    expect(check.querySelectorAll('.dash-check-table .dash-state-ok').length).toBe(6)
    await expectSettlingRow(check)
    const phiInput = check.querySelector('input[aria-label="phi（error path 相位）"]') as HTMLInputElement
    expect(phiInput).toBeTruthy()
    fireEvent.change(phiInput, { target: { value: '120' } })
    await waitFor(() => expect(within(polarityCard).getByRole('img', { name: '未通過' })).toBeTruthy())
    // 原因以 LaTeX 顯示：「C < 0：更新極性錯誤」，並列出算出來的 C = P_x|H|cos θ = −0.5
    expect(plainText(check)).toMatch(/：更新極性錯誤。/)
    expect(texIn(check)).toContain('C<0')
    expect(texIn(check)).toContain(String.raw`C=P_x|H|\cos\theta=-0.5`)
    expect(plainText(check)).not.toMatch(/\$/)
    // 失敗原因以 danger callout 顯示（ExperimentShell warnings）
    expect(check.querySelector('[role="alert"]')?.textContent).toMatch(/極性/)
  })

  it('模式切換：Beginner 隱藏進階參數；按鈕可切到 Research 並顯示額外推導', async () => {
    const { container } = renderPage('beginner')
    const dInput = () => container.querySelector('input[aria-label="D（GMAC code delay）"]')
    const spine = () => (container.querySelector('#dash-spine') as HTMLElement).textContent ?? ''
    // Beginner 把六個條件／一條方程式／動手體檢收在卡片裡：先展開（見上一個測試），再檢查裡面的呈現
    fireEvent.click(container.querySelector('details.dash-fold > summary') as HTMLElement)
    await waitFor(() => expect(container.querySelector('#dash-spine')).not.toBeNull())
    expect(dInput()).toBeNull()
    expect(spine()).not.toMatch(/推導 5（Research）/)
    // Beginner 模式的文字同樣不得出現 undefined / NaN / 未配對的 $
    const plain = container.cloneNode(true) as HTMLElement
    plain.querySelectorAll('.katex, pre, code, .c-code, .c-tip, script, style').forEach((el) => el.remove())
    expect(plain.textContent ?? '').not.toMatch(/undefined|NaN|\$/)
    expectNoTexErrors(container)
    // R12：Beginner 模式也看得到雙參數的適用範圍提醒（開關與 φ 都不在 ModeGate 內）；看完把參數改回預設
    const check = container.querySelector('#dash-check') as HTMLElement
    const toggle = check.querySelector('input[role="switch"]') as HTMLInputElement
    const phi = check.querySelector('input[aria-label="phi（error path 相位）"]') as HTMLInputElement
    fireEvent.click(toggle)
    fireEvent.change(phi, { target: { value: '50' } })
    await waitFor(() => expect(Array.from(check.querySelectorAll('.c-callout')).some((c) => texIn(c).includes(CROSS_TEX))).toBe(true))
    expect(plainText(check)).toContain('對照：兩個固定同頻單頻 code 的')
    fireEvent.change(phi, { target: { value: '0' } })
    fireEvent.click(toggle)
    await waitFor(() => expect(plainText(check)).not.toContain('對照：兩個固定同頻單頻 code 的'))
    const modes = container.querySelector('#dash-modes') as HTMLElement
    fireEvent.click(within(modes).getByRole('button', { name: /切換到 Research/ }))
    await waitFor(() => expect(spine()).toMatch(/推導 5（Research）/))
    expect(dInput()).toBeTruthy()
    expect(within(modes).getByRole('button', { name: '目前模式' })).toBeTruthy()
  })

  it('已讀紀錄：勾選章節卡片後路線進度更新', () => {
    const { container } = renderPage()
    const grid = container.querySelector('#dash-chapters') as HTMLElement
    const box = grid.querySelector('input[aria-label="標記「01 LMS 起源與 MSE / MAE」為已讀"]') as HTMLInputElement
    expect(box).toBeTruthy()
    fireEvent.click(box)
    const math = container.querySelector('.dash-route') as HTMLElement
    expect(math.textContent).toMatch(/已讀 1\//)
  })

  it('Monte Carlo 交叉比對：按下執行後以共用的 block Sign-LMS 模擬，結果與解析值一致；改參數後舊結果失效', async () => {
    const { container } = renderPage('engineer')
    const check = container.querySelector('#dash-check') as HTMLElement
    // 尚未執行：不得顯示成已比對
    expect(check.querySelector('.dash-mc-verdict')).toBeNull()
    expect(check.textContent).toMatch(/尚未執行/)
    // 用小的 N 讓測試快（jsdom 沒有 Worker，useWorkerTask 會在主執行緒 inline 執行）
    const nInput = check.querySelector('input[aria-label="N（每個 GMAC block 的樣本數）"]') as HTMLInputElement
    fireEvent.change(nInput, { target: { value: '128' } })
    const runBtn = () => check.querySelector('.dash-mc-bar button') as HTMLButtonElement
    // 8 seeds × 483 blocks（40τ + 1，τ = 12.03）× N = 128 = 494592 個 sample
    await waitFor(() => expect(texIn(check.querySelector('.dash-mc-bar'))).toContain('N=128'))
    expect(texIn(check.querySelector('.dash-mc-bar'))).toContain(String.raw`8\times483\times128=494592`)
    expect(plainText(check.querySelector('.dash-mc-bar') as Element)).toMatch(/8 個 seed、每個 seed 483 個 block/)
    fireEvent.click(runBtn())
    await waitFor(() => expect(check.querySelector('.dash-mc-verdict')).toBeTruthy(), { timeout: 30_000 })
    expect(check.querySelector('.dash-mc-verdict')?.getAttribute('data-status')).toBe('ok')
    expect(check.querySelectorAll('.dash-mc-table tbody tr')).toHaveLength(3)
    expect(check.querySelectorAll('.dash-mc-table .dash-state-ok')).toHaveLength(3)
    // ExperimentShell 的交叉比對列：Analytic 與 Monte Carlo 都是 ok，Fixed-Point 誠實標示 Not implemented
    expect(check.querySelectorAll('.c-exp-crosscheck .c-check-ok')).toHaveLength(2)
    expect(check.querySelector('.c-exp-crosscheck .c-check-not-implemented')).toBeTruthy()
    // 改 μ ⇒ 先前的結果不適用
    const muInput = check.querySelector('input[aria-label="mu（學習率）"]') as HTMLInputElement
    fireEvent.change(muInput, { target: { value: '12' } })
    await waitFor(() => expect(check.querySelector('.dash-mc-verdict')).toBeNull())
    expect(check.textContent).toMatch(/參數或 seed 已變更/)
    expect(check.querySelectorAll('.c-exp-crosscheck .c-check-ok')).toHaveLength(1)
  })

  it('Monte Carlo 不適用時說明原因（兩參數模型）', async () => {
    const { container } = renderPage('engineer')
    const check = container.querySelector('#dash-check') as HTMLElement
    const toggle = check.querySelector('input[role="switch"]') as HTMLInputElement
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    await waitFor(() => expect(check.querySelector('.dash-mc')?.textContent).toMatch(/只有一個校正係數/))
    expect(check.querySelector('.dash-mc-bar')).toBeNull()
    // R12：θ = 0° 時雙參數假設成立，不加註；把 φ 調到 50°（θ ≠ 0°）就出現「近似的適用範圍」與對照值
    const crossCallout = () => Array.from(check.querySelectorAll('.c-callout')).find((c) => texIn(c).includes(CROSS_TEX))
    const metricText = () => plainText(check.querySelector('.c-metric-table') as Element)
    expect(crossCallout()).toBeUndefined()
    expect(metricText()).not.toContain('對照：兩個固定同頻單頻 code 的')
    const phi = check.querySelector('input[aria-label="phi（error path 相位）"]') as HTMLInputElement
    fireEvent.change(phi, { target: { value: '50' } })
    await waitFor(() => expect(crossCallout()).toBeTruthy())
    expect(plainText(crossCallout() as Element)).toContain('F-DB.6')
    expect(metricText()).toContain('對照：兩個固定同頻單頻 code 的')
    // 預設步長很小：模型 0.9487、固定同頻 code 0.9507，兩者都穩定 ⇒ 六個燈號仍是通過
    expect(texIn(check).some((t) => t.includes('0.9507'))).toBe(true)
    expect(check.querySelectorAll('.dash-check-table .dash-state-ok').length).toBe(6)
    // Engineer 模式：條件就寫在 eigen-mode 表（特徵方向、g_i）旁邊
    expect(plainText(check)).toContain('來自交叉相關假設')
    // 這一句裡的 g_i 要跟著更新矩陣走：一般 LMS 是 g·λ̃_i，preconditioned 是 g（和上面 eigen-mode 表的 g_i 欄一致）
    const eigenNote = () => Array.from(check.querySelectorAll('p.small.muted')).find((el) => (el.textContent ?? '').includes('來自交叉相關假設')) as HTMLElement
    expect(texIn(eigenNote())).toContain(String.raw`g_i=g\,\tilde\lambda_i`)
    const updateSel = check.querySelector('select[aria-label="更新矩陣 M"]') as HTMLSelectElement
    fireEvent.change(updateSel, { target: { value: '1' } }) // SelectControl 的 option 值是索引：1 = preconditioned
    await waitFor(() => expect(texIn(eigenNote())).toContain('g_i=g'))
    expect(texIn(eigenNote())).not.toContain(String.raw`g_i=g\,\tilde\lambda_i`)
    fireEvent.change(updateSel, { target: { value: '0' } })
    await waitFor(() => expect(texIn(eigenNote())).toContain(String.raw`g_i=g\,\tilde\lambda_i`))
    // 圖說也註明曲線的前提
    expect(plainText(check.querySelector('figure.c-plot') as Element)).toMatch(/雙參數且.*曲線以交叉相關假設.*為前提/)
    // 調回 φ = 0°：提醒與對照列消失
    fireEvent.change(phi, { target: { value: '0' } })
    await waitFor(() => expect(crossCallout()).toBeUndefined())
    expect(metricText()).not.toContain('對照：兩個固定同頻單頻 code 的')
    // R07：eigen-mode 表下方的「弱 / 強方向」雜訊比依 λ̃ 的大小決定。ρ = −0.5、preconditioner：√κ = √3 = 1.732
    //（固定用第二個 mode 除以第一個的舊寫法在 ρ < 0 時會顯示 1/√κ = 0.5774）
    const ratioNote = () => Array.from(check.querySelectorAll('p.small.muted')).find((el) => (el.textContent ?? '').includes('弱方向 / 強方向的雜訊 RMS 比')) as HTMLElement
    const rhoInput = check.querySelector('input[aria-label="rho（regressor 零延遲相關係數）"]') as HTMLInputElement
    expect(texIn(ratioNote())).toContain(String.raw`\sigma_{\xi,\mathrm{weak}}/\sigma_{\xi,\mathrm{strong}}=1`) // ρ = 0：兩個 mode 一樣
    fireEvent.change(updateSel, { target: { value: '1' } })
    for (const rho of ['0.5', '-0.5']) {
      fireEvent.change(rhoInput, { target: { value: rho } })
      await waitFor(() => expect(texIn(check).some((t) => t.includes(`1\\pm\\rho=${rho === '0.5' ? '1.5,\\ 0.5' : '0.5,\\ 1.5'}`))).toBe(true))
      await waitFor(() => expect(texIn(ratioNote())).toContain(String.raw`\sigma_{\xi,\mathrm{weak}}/\sigma_{\xi,\mathrm{strong}}=1.732`))
      expect(texIn(ratioNote())).toContain(String.raw`\sqrt{\kappa}=1.732`)
    }
    expect(texIn(ratioNote()).join(' ')).not.toMatch(/\\sigma_\{\\xi,[-+]\}/)
    expect(plainText(ratioNote())).toContain('較小的 mode')
    expect(texIn(check).some((t) => t.includes('0.5774'))).toBe(false)
  })
})
