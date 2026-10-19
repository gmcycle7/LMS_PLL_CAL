import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import Chapter03 from './index'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

function renderChapter(mode: 'beginner' | 'engineer' | 'research', url = '/ch/03') {
  return renderPage(<Chapter03 />, { mode, url })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/**
 * 把元素內的 KaTeX 還原成 `$原始 TeX$`（取 MathML 的 annotation），其餘文字保留。
 * 字串屬性（警告、指標名稱、交叉比對附註…）裡的數學現在以 `$…$` 寫成 LaTeX，用這個函式比對「原始字串」。
 */
function srcText(root: Element): string {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex').forEach((k) => k.replaceWith(`$${k.querySelector('annotation')?.textContent ?? ''}$`))
  return clone.textContent ?? ''
}

/**
 * 單步 MC 交叉比對的附註：`單步 MC（200000 樣本）：$E[f]$ ✓、$E[f^2]$ ✓、$E\ln|f|$ ✓（$\pm4$ SE）`。
 * findByText 只看元素「自己的文字節點」（KaTeX 是子元素），所以三個 ✓ 之間只剩標點——三項都通過才會符合。
 */
const MC_OK = /單步 MC（200000 樣本）： ✓、 ✓、 ✓（ SE）/

/**
 * 逾時倍率。下面的逾時只是「測試卡死」時的保險，不是效能斷言：整章在 jsdom 渲染（上千條 KaTeX 公式、8 題帶入手算、
 * inline Monte Carlo）平常只要幾秒，但多個測試程序同時跑（全站測試、其他章節平行開發）時可以慢上數十倍。
 * 正確性一律由斷言負責；逾時只放寬、不收緊。
 */
const SLOW = 6
/** 等待 Monte Carlo 結果出現的上限 */
const WAIT = 45000 * SLOW

/** Stability Lab 的實驗外框（等待 MC 結果時只在這個範圍內查詢，不必每次掃過整章的 DOM） */
function labOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector('#exp-stability-lab')
  if (!el) throw new Error('找不到 Stability Lab（#exp-stability-lab）')
  return el as HTMLElement
}

/** 以按鈕文字找按鈕（getByRole 在這麼大的 DOM 上要算整棵 accessibility tree，非常慢） */
function btn(root: HTMLElement, label: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button')).find((x) => x.textContent?.trim() === label)
  if (!b) throw new Error(`找不到按鈕「${label}」`)
  return b
}

describe('Chapter 03 smoke test（jsdom）', () => {
  it('T02/T03: Engineer 模式完整渲染：章節、符號表、公式錨點、程式碼 region、無 KaTeX 錯誤；Stability Lab 的 Monte Carlo（inline worker）完成並通過單步交叉比對', async () => {
    const { container } = renderChapter('engineer')
    for (const id of ['fixed-x', 'random-mean', 'mean-square', 'almost-sure', 'heavy-tail', 'lab', 'compare', 'pll', 'quiz']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull()
    }
    // 符號表改放章末（教學規範 §5）：整章只有一張，在 #symbols 裡，而且是頁面的最後一塊；章首只留一行按鈕
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(container.querySelector('#symbols .c-symbols tbody tr')).not.toBeNull()
    expect(container.querySelector('.ch03')!.lastElementChild).toBe(container.querySelector('#symbols'))
    expect(Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('本章符號表在最後'))).toHaveLength(0) // 連結改由 PageFrame 的本章資訊 strip 提供
    // 方塊圖（教學規範 §8）：章首的系統地圖 + 23 張有圖號的圖（語法與內容由 diagrams.test.tsx 以真正的 mermaid 檢查）
    expect(container.querySelectorAll('figure.c-mermaid')).toHaveLength(24)
    expect(container.querySelectorAll('.ch03-fig figure.c-mermaid')).toHaveLength(23)
    // 每張圖的圖說都是共用 Mermaid 元件的 <figcaption>，以圖號開頭（圖 3-1 … 圖 3-23）
    const figcaps = Array.from(container.querySelectorAll('.ch03-fig figure.c-mermaid > figcaption.c-figcaption'))
    expect(figcaps.map((c) => (c.textContent ?? '').split('｜')[0])).toEqual(Array.from({ length: 23 }, (_, i) => `圖 3-${i + 1}`))
    for (const f of ['F-03.1', 'F-03.3', 'F-03.5', 'F-03.6', 'F-03.7', 'F-03.9', 'F-03.11', 'F-03.12', 'F-03.14', 'F-03.16', 'F-03.18']) {
      expect(container.querySelector(`[id="formula-${f}"]`), f).not.toBeNull()
    }
    expectNoTexErrors(container)
    // CodeBlock 找不到 region 時會顯示 alert「找不到程式碼 region」
    expect(container.textContent).not.toMatch(/找不到程式碼 region/)
    expect(container.querySelectorAll('.c-code').length).toBeGreaterThanOrEqual(8)
    // 勘誤標記連到驗證頁（#/verification），並以 ?e=Exx 深連結到該條勘誤
    const errataLinks = Array.from(container.querySelectorAll('a.ch03-erratum'))
    expect(errataLinks.length).toBeGreaterThan(5)
    expect(errataLinks.every((a) => /^#\/verification\?e=E\d{2}$/.test(a.getAttribute('href') ?? ''))).toBe(true)
    expect(errataLinks.every((a) => a.textContent === `勘誤 ${a.getAttribute('href')!.split('e=')[1]}`)).toBe(true)
    for (const e of ['E14', 'E38', 'E39', 'E42']) expect(errataLinks.some((a) => a.textContent?.includes(e))).toBe(true)
    // 三個實驗外框（各自的標題；直接查外框的標題元素，不必掃過整章的 DOM）
    const shellTitle = (id: string) => container.querySelector(`[id="exp-${id}-title"]`)?.textContent ?? ''
    expect(shellTitle('stability-fixed-x')).toMatch(/Fixed-x Pole Explorer/)
    expect(shellTitle('stability-lab')).toMatch(/Stability Lab：Mean、Mean-Square 與 Almost-Sure/)
    expect(shellTitle('stability-heavytail')).toMatch(/Heavy-tail 示範/)
    // Monte Carlo 結果出現（inline 模式執行 runStabilityMcCases）
    const lab = within(labOf(container))
    expect((await lab.findAllByText(/^MC 中位數$/, {}, { timeout: WAIT })).length).toBeGreaterThan(0)
    expect((await lab.findAllByText(MC_OK, {}, { timeout: WAIT })).length).toBeGreaterThan(0)
    // 字串屬性裡的數學是 LaTeX（`$…$` → KaTeX）：以原始 TeX 比對
    const labSrc = srcText(container.querySelector('#exp-stability-lab') as HTMLElement)
    expect(labSrc).toContain(String.raw`MC 中位數 $\log_{10}|\delta_N|$`)
    expect(labSrc).toContain(String.raw`單步 MC（200000 樣本）：$E[f]$ ✓、$E[f^2]$ ✓、$E\ln|f|$ ✓（$\pm4$ SE）`)
    // 預設 μ = 0.8：必須解釋 MSD 發散但路徑收斂（勘誤 E14），而不是只寫「發散」
    expect(labSrc).toContain(String.raw`$g(\mu) = 1.32 \ge 1$：係數均方偏差 $\text{MSD} = E[\delta^2]$ 發散`)
    expect(labSrc).toMatch(/幾乎每條路徑仍收斂/)
    // Analytic 交叉比對是「封閉式 vs 獨立數值積分」實際算出來的，不是寫死的 ok
    expect(labSrc).toContain(String.raw`$g$、$h$：動差封閉式 vs 數值積分`)
    expect(labSrc).toContain(String.raw`$\lambda$：Dawson 形式 vs lms.ts 直接積分`)
    expect(container.querySelectorAll('.c-check-mismatch')).toHaveLength(0)
    // F-03.18：CLT 預測表（μ = 2、N = 200 的 83.1% 即勘誤 E14 的數字）與 Lab 的 CLT 指標列
    expect(container.textContent).toMatch(/83\.1%/)
    expect(labSrc).toContain(String.raw`$P(|\delta_N| < 10^{-3}|\delta_0|)$：MC 收斂比例`)
    expect(labSrc).toContain(String.raw`$s = \sqrt{\operatorname{Var}(\ln|1-\mu x^2|)}$：單步 MC 的樣本標準差`)
    // 公式登錄的名稱與使用條件也以 LaTeX 顯示（FBlock → mathText）
    const f1 = srcText(container.querySelector('[id="formula-F-03.1"]')!.parentElement as HTMLElement)
    expect(f1).toContain(String.raw`固定 $x$、無雜訊的誤差遞迴（$\delta = a - w$）`)
    expect(f1).toContain(String.raw`$\delta$ 極性採全站約定 $\delta = a - w$`)
    // 帶入手算：8 題各自緊跟在對應的公式／推導之後，綜合題（HC-03.8）在思考題之前；每題前面有一句邀請
    const hcIds = Array.from(container.querySelectorAll('section.c-handcalc')).map((el) => el.id)
    expect(hcIds).toEqual(Array.from({ length: 8 }, (_, i) => `handcalc-HC-03.${i + 1}`))
    expect(container.querySelectorAll('.ch03-handcalc-invite')).toHaveLength(8)
    const at = (sel: string) => {
      const el = container.querySelector(sel)
      if (!el) throw new Error(`找不到 ${sel}`)
      return el
    }
    const inOrder = (...sels: string[]) => sels.every((sel, i) => i === 0 || !!(at(sels[i - 1]).compareDocumentPosition(at(sel)) & Node.DOCUMENT_POSITION_FOLLOWING))
    const hc = (n: number) => `[id="handcalc-HC-03.${n}"]`
    const fm = (id: string) => `[id="formula-${id}"]`
    expect(inOrder(fm('F-03.3'), hc(1), fm('F-03.4'), hc(2), '#random-mean')).toBe(true)
    expect(inOrder(fm('F-03.5'), hc(3), '#mean-square', fm('F-03.7'), hc(4), fm('F-03.11'), hc(5), '#almost-sure')).toBe(true)
    expect(inOrder(fm('F-03.10'), hc(6), '#heavy-tail', fm('F-03.18'), hc(7), fm('F-03.16'))).toBe(true)
    expect(inOrder('#pll', '#synthesis', hc(8), '#quiz')).toBe(true)
    // 頁面骨架（teaching-style §9）：開場問題 → 系統地圖 → 你在這裡（.c-map-note）→ 標籤列 → 各節 → 思考題 → 本課必記 → 符號表
    expect(inOrder('#ch03-top', 'figure.c-mermaid', '.c-map-note', '.ch03-tags', '#fixed-x', '#quiz', '.c-recap', '#symbols')).toBe(true)
    expect(container.querySelector('figure.c-mermaid')!.nextElementSibling).toBe(container.querySelector('.c-map-note'))
    expect(container.querySelectorAll('.c-handcalc .c-step').length).toBeGreaterThanOrEqual(8 * 7)
    // HC-03.3 的預設值（五階 code）就是它正前方內文的數字例；每個等號只做一種運算（1 − μx²：先乘、再減）
    const meanSec = srcText(at(hc(3)).closest('.c-section') as HTMLElement)
    expect(meanSec).toContain(String.raw`$\{-2,-1,0,1,2\}$`)
    expect(meanSec).toContain(String.raw`$M_4=\tfrac{16+1+0+1+16}{5}=6.8$`)
    expect(srcText(at(hc(3)))).toContain(String.raw`$M_4=E[x^4]=\frac{16+1+0+1+16}{5}=\frac{34}{5}=6.8$`)
    expect(srcText(at(hc(1)))).toContain(String.raw`$p=1-\mu x^2=1-0.1\times4=1-0.4=0.6$`)
    // T03 表：網站即時計算的 g 與 Python golden 逐項一致
    expect(container.textContent).not.toMatch(/✗ 不一致/)
    // 勘誤 E42：E[δ²] 不可再被稱為「均方誤差」
    expect(container.querySelector('#mean-square')!.textContent).not.toMatch(/均方誤差/)
    expect(container.querySelector('#mean-square')!.textContent).toMatch(/MSD/)
  }, 90000 * SLOW)

  it('教學規範：內文沒有殘留的 $（tx 行內數學全部轉成 KaTeX），也沒有 KaTeX 錯誤', () => {
    const { container } = renderChapter('research')
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('pre, code, .c-code, .katex').forEach((el) => el.remove())
    expect(clone.textContent).not.toMatch(/\$/)
    expectNoTexErrors(container)
    // Research：浮點 deadbeat 註記的數字是即時計算的（1 − μx² 只到 1e−16 等級）
    expect(container.textContent).toMatch(/Research：浮點下的 deadbeat/)
  }, 60000 * SLOW)

  it('Research 模式顯示研究層級內容（Dawson 形式、Kesten 尾指數）', () => {
    const { container } = renderChapter('research')
    expect(container.querySelector('[id="formula-F-03.15"]')).not.toBeNull()
    expect(container.querySelector('[id="formula-F-03.17"]')).not.toBeNull()
    expectNoTexErrors(container)
    expect(container.querySelectorAll('details.ch03-steps[open]').length).toBeGreaterThan(5)
  }, 60000 * SLOW)

  it('Beginner 模式：逐步推導預設收合，研究內容隱藏', () => {
    const { container } = renderChapter('beginner')
    expect(container.querySelector('[id="formula-F-03.15"]')).toBeNull()
    const steps = container.querySelectorAll('details.ch03-steps')
    expect(steps.length).toBeGreaterThan(5)
    expect(container.querySelectorAll('details.ch03-steps[open]')).toHaveLength(0)
    expect(container.textContent).toMatch(/點開看逐步推導/)
  }, 60000 * SLOW)

  it('T02: ±1 code preset（|x| 常數、SE = 0 的退化情況）單步 MC 交叉比對仍為 ✓', async () => {
    const { container } = renderChapter('engineer', '/ch/03?preset=stability-bpsk-mu15')
    expect((await within(labOf(container)).findAllByText(MC_OK, {}, { timeout: WAIT })).length).toBeGreaterThan(0)
    const labSrc = srcText(labOf(container))
    expect(labSrc).toContain(String.raw`$P_x = E[x^2]$`) // 指標表已渲染
    expect(labSrc).not.toContain(String.raw`Case A：$g(\mu)`) // g = 0.25 < 1：不應出現 MSD 發散警告
  }, 90000 * SLOW)

  it('?preset= 會載入 Stability Lab 的 preset（稀疏 code：mean 收斂、路徑發散的警告）', () => {
    const { container } = renderChapter('engineer', '/ch/03?preset=stability-sparse-mu05')
    const labSrc = srcText(container.querySelector('#exp-stability-lab') as HTMLElement)
    expect(labSrc).toContain(String.raw`$\lambda(\mu) = E\ln|1-\mu x^2| = 0.1253 \ge 0$：almost-sure 發散`)
    // mean 因子 0.55 在單位圓內，所以沒有 mean 發散的警告（mean 收斂、路徑發散）
    expect(labSrc).not.toContain('mean 發散')
  }, 60000 * SLOW)

  it('T02: Fixed-x Explorer 的單步 / 執行 / 執行至收斂（規格 §19：Single Step、Run-to-Convergence）與逐步更新表', () => {
    const { container } = renderChapter('beginner')
    const exp = container.querySelector('#exp-stability-fixed-x') as HTMLElement
    expect(exp).not.toBeNull()
    const table = () => exp.querySelector('table[aria-label="Case A 的逐步更新表"]') as HTMLTableElement
    const bodyRows = () => Array.from(table().querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent))
    // 預設顯示全部（表格最多列 n = 0…12）；T01 手算值 w = 1, 1.8, 2.28、δ = 2, 1.2, 0.72（δ = a − w，勘誤 E39）
    expect(bodyRows()).toHaveLength(13)
    expect(bodyRows()[0].slice(0, 4)).toEqual(['0', '1', '4', '2'])
    expect(bodyRows()[1].slice(0, 4)).toEqual(['1', '1.8', '2.4', '1.2'])
    expect(bodyRows()[2].slice(0, 2)).toEqual(['2', '2.28'])
    expect(bodyRows()[2][3]).toBe('0.72')
    expect(bodyRows()[2][4]).toBe('0.72') // 封閉式 δ₀pⁿ 與遞迴一致
    // 單步：從 n = 1 開始，一次多一列
    fireEvent.click(btn(exp, '單步 Step'))
    expect(exp.textContent).toMatch(/單步模式：目前顯示到第 1 步（共 20 步）/)
    expect(bodyRows()).toHaveLength(2)
    fireEvent.click(btn(exp, '單步 Step'))
    expect(bodyRows()).toHaveLength(3)
    // 執行：回到全部顯示
    fireEvent.click(btn(exp, '執行 Run'))
    expect(exp.textContent).toMatch(/顯示全部步數/)
    expect(bodyRows()).toHaveLength(13)
    // 執行至收斂：p = 0.6 → ⌈ln10⁻³/ln0.6⌉ = 14 步
    fireEvent.click(btn(exp, '執行至收斂 Run-to-Convergence'))
    expect(exp.textContent).toMatch(/= 14 步，已把步數設為 14/)
    expect(exp.querySelector('.ch03-note .katex')).not.toBeNull() // 說明中的數學以 KaTeX 排版
  }, 90000 * SLOW)

  it('T02: （反面測試）Fixed-x Explorer 的極性反轉 preset（μ < 0）：警告解釋原因，「執行至收斂」說明為何做不到', () => {
    const { container } = renderChapter('beginner', '/ch/03?preset=stability-fx-negative')
    const exp = container.querySelector('#exp-stability-fixed-x') as HTMLElement
    expect(srcText(exp)).toContain(String.raw`$\mu = -0.01 < 0$：更新方向反了（等同極性反轉），$p = 1-\mu x^2 = 1.04 > 1$`)
    fireEvent.click(btn(exp, '執行至收斂 Run-to-Convergence'))
    expect(exp.textContent).toMatch(/誤差不會收斂到 0，無法「執行至收斂」/)
    expect(exp.querySelector('.ch03-note')!.textContent).toMatch(/1\.04/)
    expect(exp.querySelectorAll('.c-check-mismatch')).toHaveLength(0) // 發散時遞迴與封閉式仍一致
  }, 90000 * SLOW)

  it('T03: Stability Lab 的 Freeze / Run / Run-to-Convergence；μ = 2、N = 200 時 MC 收斂比例與 CLT 預測（83.1%，勘誤 E14）在指標表中一致', async () => {
    const { container } = renderChapter('beginner')
    const exp = container.querySelector('#exp-stability-lab') as HTMLElement
    const ui = within(exp)
    const mcNote = MC_OK
    await ui.findAllByText(mcNote, {}, { timeout: WAIT })
    // 凍結：之後改參數不會自動重跑
    fireEvent.click(btn(exp, '凍結 Freeze'))
    expect(btn(exp, '已凍結 Frozen').getAttribute('aria-pressed')).toBe('true')
    expect(exp.textContent).toMatch(/已凍結：改參數時 Monte Carlo 不會自動重跑/)
    const muLabel = Array.from(exp.querySelectorAll('label.c-param-label')).find((l) => srcText(l).includes(String.raw`$\mu$（Case A）`)) as HTMLLabelElement
    const muInput = exp.querySelector(`[id="${muLabel.htmlFor}"]`) as HTMLInputElement
    fireEvent.change(muInput, { target: { value: '2' } })
    await new Promise((r) => setTimeout(r, 700)) // 超過 debounce（300 ms）
    expect(exp.textContent).toMatch(/目前參數與凍結時不同，MC 曲線已隱藏/)
    expect(ui.queryAllByText(mcNote)).toHaveLength(0) // 沒有偷跑：新參數還沒有 MC 結果
    expect(srcText(exp)).toContain(String.raw`$|1-\mu P_x| = 1 \ge 1$：mean 發散`) // 解析結果仍即時更新（mean pole = −1）
    // 執行 Run：凍結中也以目前參數重跑一次
    fireEvent.click(btn(exp, '執行 Run'))
    await ui.findAllByText(mcNote, {}, { timeout: WAIT })
    const row = Array.from(exp.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('MC 收斂比例')) as HTMLTableRowElement
    expect(row.textContent).toMatch(/0\.83099/) // CLT 預測 Φ((ln10⁻³ − 200λ)/(s√200))
    expect(row.getAttribute('data-pass')).toBe('true') // MC（2000 條路徑）與 CLT 預測相差 < 0.05
    const sRow = Array.from(exp.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('單步 MC 的樣本標準差')) as HTMLTableRowElement
    expect(sRow.getAttribute('data-pass')).toBe('true')
    // 執行至收斂：λ(2) = −0.1162 → ⌈ln10⁻³/λ⌉ = 60 步，N 設為 120；g = 9 ≥ 1 要提醒 MSD 仍發散；並解除凍結
    fireEvent.click(btn(exp, '執行至收斂 Run-to-Convergence'))
    expect(exp.textContent).toMatch(/= 60 步；已把步數設為 120（2 倍典型步數為 120）/)
    expect(exp.querySelector('.ch03-note')!.textContent).toMatch(/所以 MSD 仍然發散/)
    expect(exp.querySelector('.ch03-note .katex')).not.toBeNull()
    expect(btn(exp, '凍結 Freeze').getAttribute('aria-pressed')).toBe('false')
    const noteEls = await ui.findAllByText(/^、2000 條路徑$/, {}, { timeout: WAIT }) // 附註「$N = 120$、2000 條路徑」（N 以 KaTeX 顯示）
    await waitFor(() => expect(noteEls.some((el) => el.isConnected && srcText(el).includes('$N = 120$、2000 條路徑')) || srcText(exp).includes('$N = 120$、2000 條路徑')).toBe(true), { timeout: WAIT })
  }, 150000 * SLOW)

  it('先備知識與名詞：Gaussian／Uniform 分布、對原點的 kurtosis、厚尾；單位欄不再把 a、w、δ 標成無單位', () => {
    const { container } = renderChapter('beginner')
    const text = container.textContent ?? ''
    expect(text).toMatch(/隨機變數、機率密度，以及 Gaussian（常態）／Uniform（均勻）／.*三種分布/)
    const prereq = Array.from(container.querySelectorAll('details')).find((d) => d.textContent?.includes('隨機變數、機率密度')) as HTMLElement
    expect(srcText(prereq.querySelector('summary')!)).toContain(String.raw`／$\pm A$ 三種分布`)
    expect(text).toMatch(/用「對原點」的動差/)
    expect(text).toMatch(/heavy tail（厚尾）/)
    const rows = Array.from(container.querySelectorAll('#symbols .c-symbols tbody tr')).map((tr) => tr.textContent ?? '')
    expect(rows.length).toBeGreaterThanOrEqual(26)
    // a、w_n、δ_n 的單位是 [y]/[x]（由 y = a·x 推得），MSD 是其平方
    expect(rows.filter((r) => r.includes('[y]/[x]')).length).toBeGreaterThanOrEqual(4)
    expect(container.querySelector('a[href="#/case/sspll"]')).not.toBeNull()
  }, 60000 * SLOW)
})
