import { readdirSync, readFileSync } from 'node:fs'
import { expectNoTexErrors } from '@/test/katex'
import { join } from 'node:path'
import { act, cleanup, waitFor } from '@testing-library/react'
import { renderTex } from '@/components'
import { plotMath } from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import type { PresetEntry } from '@/data/types'
import { CH04_DIAGRAMS } from './diagrams'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { DEFAULT_FLOW_CASE, DEFAULT_FLOW_SHARED, FLOW_MC_RUNS, flowAnalyticCheck, flowConfig, flowMonteCarlo } from './experiments/SignalFlowExperiment'
import { DEFAULT_FP_CASE, DEFAULT_FP_SHARED, SINGLE_SEED_HINT, buildLoopParams, roundingPredictionOk } from './experiments/FixedPointExperiment'
import { DITHER_MIN, ROUNDING_MODES, ar1MeanSe, compareEncodings, ditherMinFor, halfEvenTieAmplitude, roundingMeanError, runFixedGmacLoop, sumAverageTable } from '@/simulation/models/gmac'
import { erf } from '@/simulation/core'
import { DEFAULT_ENCODING } from './experiments/BitEncodingExperiment'
import { runBlockLms } from '@/simulation/models/blockLms'
import { handGmac } from './sections/GmacMath'
import { sliceGoldenGmac, defaultBiasNumbers, negateBugNumbers, windupNumbers, wTruncNumbers } from './sections/FixedPoint'
import { clearVsNoClear } from './sections/HardwareNotes'
import { DEFAULT_RESIDUE, HAND } from './sections/Residue'
import { QUIZ_SETTLE_RATIO, part1QuizNumbers } from './sections/Part1Quiz'
import { CH04_SYMBOLS } from './sections/Symbols'
import { firstOrderAccumulator, residueSignals } from './residue'
import { PAGE_TIMEOUT, WAIT, caseButtons, proseText, renderAt, shellOf, texText } from './pageTestUtils'

import { plotlyMock as P } from '@/test/mocks/plotly'
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
// 記錄 Plot 送進 Plotly 之前的 data／layout（`$...$` 還沒轉成 pseudo-HTML），檢查圖內文字都用 LaTeX 寫
const PM = vi.hoisted(() => ({ calls: [] as [unknown, unknown][] }))
vi.mock('@/components/plotMath', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...orig,
    applyPlotMath: <D, L>(data: D, layout: L) => {
      PM.calls.push([data, layout])
      return orig.applyPlotMath(data, layout)
    },
  }
})
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

afterEach(() => {
  // 先卸載頁面，再清掉 mock 的呼叫紀錄。Plotly mock（react／purge…）與 applyPlotMath 的紀錄會留住每次呼叫的引數——圖的 DOM 節點連著整頁的 DOM、
  // 還有整組資料陣列；Plot 卸載時呼叫的 Plotly.purge(gd) 也會被記下來，所以順序是「卸載 → 清紀錄」（不清的話每渲染一次整頁就多留約 0.5 GB）。
  // 另外，整頁渲染之後 worker 的 heap 並不會完全回到原點（jsdom 下每頁還會留住數百 MB），所以需要整頁渲染的測試分成兩個檔案、
  // 各用一個 worker：StrictMode 與實驗互動在 ch04.interaction.test.tsx。全部擠在同一個檔案時 heap 會撞到 4 GB 的上限（JavaScript heap out of memory）。
  cleanup()
  localStorage.clear()
  PM.calls.length = 0
  for (const m of [P.react, P.purge, P.toImage, P.downloadImage, P.Plots.resize]) m.mockClear()
})

function loadPreset(id: string): PresetEntry {
  return JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'presets', `${id}.json`), 'utf8')) as PresetEntry
}

/** Plot 的 data／layout 裡會顯示的文字欄位（與 plotMath.ts 處理的欄位相同）的字串 */
const PLOT_TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label'])
function plotStrings(value: unknown, key: string | null = null, depth = 0, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (key !== null && PLOT_TEXT_KEYS.has(key)) out.push(value)
    return out
  }
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return out
  if (Array.isArray(value)) {
    if (typeof value[0] === 'number') return out
    for (const v of value) plotStrings(v, key, depth + 1, out)
    return out
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) plotStrings(v, k, depth + 1, out)
  return out
}

function headings(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('h1, h2, h3, h4')).map((h) => (h.textContent ?? '').trim())
}

describe('Ch04 頁面（jsdom smoke test）', () => {
  it('渲染不丟錯：章末的符號表、所有段落、三個實驗、勘誤連結、公式錨點與 FORMULAS 一致', async () => {
    const errSpy = vi.spyOn(console, 'error')
    PM.calls.length = 0
    const { container } = renderAt()
    // 符號表在整頁最後（Recap 與「連結到 PLL」之後），外層 id="symbols"；章首不放符號表，只留一行捲到它的連結（teaching-style §5）
    const page = container.querySelector('.ch04')!
    const symbols = container.querySelector('#symbols')!
    expect(page.lastElementChild).toBe(symbols)
    expect(container.querySelectorAll('.c-symbols').length).toBe(1)
    expect(symbols.lastElementChild!.classList.contains('c-symbols')).toBe(true)
    expect(symbols.querySelector('.c-symbols-title')!.textContent).toBe('本章符號表')
    expect(symbols.querySelectorAll('tbody tr').length).toBe(CH04_SYMBOLS.length)
    expect(new Set(CH04_SYMBOLS.map((r) => r.symbol)).size).toBe(CH04_SYMBOLS.length)
    for (const after of ['.c-recap', '#ch04-wrap', '.c-quiz']) {
      const all = container.querySelectorAll(after)
      expect(all[all.length - 1].compareDocumentPosition(symbols) & Node.DOCUMENT_POSITION_FOLLOWING, after).toBeTruthy()
    }
    // 章首骨架（teaching-style §9）：問題是 root 的第一個區塊、系統地圖緊接在後、「你在這裡」是 .c-map-note；
    // 章首不放符號表，也沒有「本章符號表在最後」那一行（連結在 PageFrame 的本章資訊 strip 裡）
    const question = container.querySelector<HTMLElement>('#ch04-question')!
    expect(question.querySelector('.c-symbols')).toBeNull()
    expect(page.firstElementChild).toBe(question)
    const sysmap = container.querySelector('figure.c-sysmap')!
    expect(question.nextElementSibling).toBe(sysmap)
    expect(sysmap.nextElementSibling).toBe(container.querySelector('.c-map-note'))
    expect(container.querySelector('.ch04-symbols-link')).toBeNull()
    expect(container.textContent).not.toContain('本章符號表在最後')
    // 章末符號表上方的按鈕捲回章首
    const proto = Element.prototype as unknown as { scrollIntoView?: (this: Element) => void }
    const scrolled: string[] = []
    proto.scrollIntoView = function () {
      scrolled.push(this.id)
    }
    const back = symbols.querySelector<HTMLButtonElement>('.ch04-symbols-back button')!
    expect(back.textContent).toContain('回到章首')
    act(() => back.click())
    expect(scrolled).toEqual(['ch04-question'])
    scrolled.length = 0
    // 章首目錄（符號說明、接法之後）同樣是按鈕，分成 Part 1／Part 2／章末三列：第一個捲到 §1
    const guide = container.querySelector<HTMLElement>('.ch04-guide')!
    expect(sysmap.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const toc = Array.from(guide.querySelectorAll<HTMLButtonElement>('.ch04-toc button'))
    expect(Array.from(guide.querySelectorAll('.ch04-toc-group')).map((g) => g.textContent)).toEqual(['Part 1 訊號流', 'Part 2 硬體實作', '章末'])
    expect(toc.map((b) => b.textContent)).toEqual(['§1 系統全貌', '§2 Fractional residue', '§3 GMAC 數學', '思考題', '§4 硬體對應與時序', '§5 定點 GMAC', '§5b DTC 範圍與延遲預算', '§6 RTL 檢查清單', '§7 綜合手算與思考題', '§8 本課必記'])
    act(() => toc[0].click())
    expect(scrolled).toEqual(['ch04-system'])
    // 目錄跳到 Part 2 裡的段落時會先展開 Part 2 的摺疊框（jumpTo 用共用的 scrollToElement：展開祖先 <details>）；這個測試沒有設定模式，所以是 Beginner、Part 2 收合
    const part2 = container.querySelector<HTMLDetailsElement>('details.ch04-part')!
    expect(part2.open).toBe(false)
    act(() => toc[4].click())
    expect(scrolled).toEqual(['ch04-system', 'ch04-hardware'])
    expect(part2.open).toBe(true)
    part2.open = false
    delete proto.scrollIntoView
    // 整頁（含實驗框內共用 MetricTable 的「公式」欄）沒有會改到路由的 href="#xxx"（「#/…」是 HashRouter 的路由連結，不算）；
    // 公式連結是 FormulaLink：href 為 '#/formulas?f=…'
    const hashAnchors = Array.from(container.querySelectorAll('a[href^="#"]')).filter((a) => !a.getAttribute('href')!.startsWith('#/'))
    expect(hashAnchors.map((a) => a.getAttribute('href'))).toEqual([])
    const hs = headings(container)
    for (const t of ['§1 完整概念系統', '§2 Fractional residue', '§3 GMAC 的數學', '思考題（Part 1：訊號流與數學）', '§4 硬體對應', '§5 定點 GMAC', '§5b DTC 的範圍、LSB、量化抖動與', '§6 RTL 檢查清單', '§7 比較表、綜合手算與思考題（Part 2）', '§8 本課必記']) {
      expect(hs.some((h) => h.startsWith(t)), t).toBe(true)
    }
    // 兩個 Part（index.tsx）：Part 1 = 章首之後的橫幅 + §1–§3 + 思考題；Part 2 = 一個 <details>，裡面依序是 §4–§7；§8 本課必記與符號表在摺疊框外面
    const part1Head = container.querySelector('.ch04-part-head')!
    expect(part1Head.querySelector('h2')!.id).toBe('ch04-part-1')
    expect(part1Head.textContent).toContain('Part 1')
    expect(part1Head.textContent).toContain('訊號流：DTC → DSM → PD → GMAC')
    expect(question.compareDocumentPosition(part1Head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(part1Head.compareDocumentPosition(container.querySelector('#ch04-system')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const part2Fold = container.querySelector<HTMLDetailsElement>('details.ch04-part')!
    expect(part2Fold.querySelector('summary h2')!.id).toBe('ch04-part-2')
    expect(part2Fold.querySelector('summary')!.textContent).toContain('硬體實作：定點、暫存器、RTL 對照')
    expect(Array.from(part2Fold.querySelectorAll(':scope > .ch04-part-body > section')).map((el) => el.id)).toEqual(['ch04-hardware', 'ch04-fixed', 'ch04-dtc-range', 'ch04-notes', 'ch04-wrap'])
    for (const id of ['ch04-question', 'ch04-part-1', 'ch04-system', 'ch04-residue', 'ch04-gmac', 'ch04-part1-quiz', 'ch04-recap', 'symbols']) expect(part2Fold.contains(container.querySelector(`#${id}`)!), id).toBe(false)
    const order = ['ch04-question', 'ch04-part-1', 'ch04-system', 'ch04-residue', 'ch04-gmac', 'ch04-part1-quiz', 'ch04-part-2', 'ch04-hardware', 'ch04-fixed', 'ch04-dtc-range', 'ch04-notes', 'ch04-wrap', 'ch04-recap', 'symbols'].map((id) => container.querySelector(`#${id}`)!)
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, order[i].id).toBeTruthy()
    // Beginner（這個測試沒有設定模式）：Part 2 收合，summary 留一句摘要與「切到 Engineer 會自動展開」的提示；本課必記（Recap）不在摺疊框裡
    expect(part2Fold.open).toBe(false)
    expect(part2Fold.querySelector('.ch04-part-hint')!.textContent).toContain('切到 Engineer')
    expect(container.querySelector('#ch04-recap .c-recap')).not.toBeNull()
    expect(container.querySelectorAll('.c-recap').length).toBe(1)
    for (const t of ['GMAC 訊號流：一個 block 內逐 sample 追蹤', '定點 GMAC：位元數、overflow、rounding 偏差與 anti-windup', 'Fractional residue explorer：DSM → DTC 要補償什麼']) {
      expect(hs).toContain(t)
    }
    // 標題裡的 ±1 是 KaTeX（$\pm1$）
    const encTitle = Array.from(container.querySelectorAll('h1, h2, h3, h4')).find((h) => (h.textContent ?? '').startsWith('反面教材：comparator 0/1 忘了映射成'))
    expect(encTitle && texText(encTitle)).toBe('反面教材：comparator 0/1 忘了映射成 \\pm1')
    // 八題「帶入手算」都在頁面上；綜合題（HC-04.8，Part 2）在 Part 2 的思考題之前。思考題共十題：Part 1 六題（數學／訊號流）、Part 2 四題（RTL），依序編號 1–10
    const hcIds = Array.from(container.querySelectorAll('section.c-handcalc')).map((s) => s.id)
    expect(hcIds).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    expect(container.querySelectorAll('.ch04-handcalc-lead').length).toBe(HANDCALCS.length)
    const lastHc = container.querySelector('[id="handcalc-HC-04.8"]')!
    const firstPart2Quiz = container.querySelector('#ch04-wrap .c-quiz')!
    expect(lastHc.compareDocumentPosition(firstPart2Quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const quizTitles = Array.from(container.querySelectorAll('.c-quiz .c-quiz-title')).map((t) => texText(t))
    expect(quizTitles.length).toBe(10)
    quizTitles.forEach((t, i) => expect(t, t).toMatch(new RegExp(`^思考題 ${i + 1}（`)))
    expect(container.querySelectorAll('#ch04-part1-quiz .c-quiz').length).toBe(6)
    expect(container.querySelectorAll('#ch04-wrap .c-quiz').length).toBe(4)
    expect(quizTitles.slice(0, 6).join('\n')).toMatch(/residue 的範圍與平均[^]*fractional residue[^]*DTC 延遲與 code 的線性關係[^]*GMAC 累加的尺度[^]*\\mu 與收斂步數[^]*忘了映射/)
    expect(quizTitles.slice(6).join('\n')).toMatch(/sum vs average[^]*累加器位元數[^]*floor 的偏差[^]*\\mu 減半/)
    // 每一題思考題都有提示（題幹最後一行）與解析按鈕
    for (const q of Array.from(container.querySelectorAll('#ch04-part1-quiz .c-quiz'))) {
      expect(q.querySelector('.c-quiz-q')!.textContent).toContain('提示：')
      expect(q.querySelector('button')!.textContent).toBe('看答案與解析')
    }
    expect(container.querySelector('#ch04-part1-quiz')!.compareDocumentPosition(part2Fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const s of Array.from(container.querySelectorAll('section.c-handcalc'))) expect(s.querySelectorAll('.c-step').length, s.id).toBeGreaterThan(0)
    // 23 張 Mermaid 圖的圖說由 MermaidFig 顯示：符號是 KaTeX（共用 Mermaid 的 caption 只能放純文字）；
    // 圖的內容、順序與實際渲染由 diagrams.test.tsx 檢查
    const figCaptions = Array.from(container.querySelectorAll('.ch04-mermaid-fig .ch04-mermaid-caption'))
    expect(figCaptions.length).toBe(CH04_DIAGRAMS.length)
    expect(figCaptions.length).toBe(23)
    for (const c of figCaptions) expect(c.querySelector('.katex'), c.textContent ?? '').not.toBeNull()
    expect(figCaptions.map((c) => texText(c)).join('\n')).toContain('乘 \\mu')
    // 共用 Mermaid 自己的 figcaption 只有章首的系統地圖（SystemMap）那一個
    const ownCaptions = Array.from(container.querySelectorAll('.c-mermaid figcaption'))
    expect(ownCaptions.length).toBe(1)
    expect(ownCaptions[0].textContent).toMatch(/^系統地圖：藍色是這一課從頭走到尾的訊號路徑/)
    expect(ownCaptions[0].querySelector('.katex')).not.toBeNull() // 圖說裡的符號是 KaTeX
    expect(sysmap.contains(ownCaptions[0])).toBe(true)
    // 勘誤標籤連到驗證頁
    const errata = Array.from(container.querySelectorAll('a.ch04-erratum'))
    for (const id of ['E07', 'E13', 'E18']) expect(errata.some((a) => a.textContent === `勘誤 ${id}` && a.getAttribute('href') === '#/verification')).toBe(true)
    // 每個登錄的公式在頁面上都有錨點
    for (const fm of FORMULAS) expect(container.querySelector(`[id="formula-${fm.id}"]`), fm.id).not.toBeNull()
    // CodeBlock 的 region 都找得到（找不到時顯示「程式碼載入錯誤」）
    expect(container.textContent).not.toContain('程式碼載入錯誤')
    // 所有 TeX 都能被 KaTeX 解析（含 Beginner 收合的推導與 Part 2；這個測試沒有設定模式，所以是第一次造訪的 Beginner）
    expectNoTexErrors(container)
    // Worker 計算（jsdom 下 inline）完成後出現結果
    await waitFor(() => expect(shellOf(container, 'gmac-fixed-point').textContent).toContain('（定點減浮點）[fs]'), WAIT)
    await waitFor(() => expect(texText(shellOf(container, 'gmac-bit-encoding'))).toContain('0/1 直接用（bug）：後半段平均 w'), WAIT)
    // 實驗算完後（指標名稱、交叉比對附註、警告都出現了）：字串屬性裡的 $...$ 全部轉成 KaTeX，沒有殘留的 $，也沒有 KaTeX 錯誤
    expect(proseText(container)).not.toContain('$')
    expectNoTexErrors(container)
    expect(texText(shellOf(container, 'gmac-bit-encoding'))).toContain('0/1 → q=2b-1：後半段平均 w')
    expect(texText(shellOf(container, 'gmac-fixed-point'))).toContain('最壞情況需要的 B_\\mathrm{acc}（精確）')
    expect(P.react).toHaveBeenCalled()
    // 互動圖裡的數學也是 LaTeX（docs/teaching-style.md §3）：圖內文字（軸標題、圖例、標題）的公式寫成 `$...$`，
    // 其餘文字沒有 Unicode 拼的數學；轉成 Plotly 的 pseudo-HTML 之後不剩反斜線、大括號與 `$`
    const plotTexts = [...new Set(PM.calls.flatMap(([d, l]) => [...plotStrings(d), ...plotStrings(l)]))]
    expect(plotTexts.filter((t) => t.includes('$')).length).toBeGreaterThanOrEqual(25)
    for (const t of plotTexts) {
      expect((t.match(/(?<!\\)\$/g) ?? []).length % 2, `「${t}」的 $ 沒有成對`).toBe(0)
      expect(unicodeMathIn(t.replace(/\$[^$]*\$/g, ' ')), `圖內文字「${t}」還有 Unicode 拼的數學`).toEqual([])
      const shown = plotMath(t).replace(/<\/?(i|b|sub|sup|br)>/g, '').replace(/%\{[^}]*\}/g, '')
      expect(shown, `圖內文字「${t}」轉換後還有 TeX 語法`).not.toMatch(/[\\{}$]/)
    }
    for (const t of [String.raw`$w_k$ [fs/code]`, String.raw`block $k$`, String.raw`bipolar $\pm1$`, String.raw`$a(k)$`, String.raw`$E[S]/2^{\ell}$（真實平均，輸出 LSB）`, String.raw`$y[n]$`, String.raw`$E[\delta_k]/\delta_0$`, String.raw`累加 $S$（running sum）`]) {
      expect(plotTexts, t).toContain(t)
    }
    // 外部審查 R11：half-even 的 0 另需「恰好一半」時商的奇偶各半——條件在 Engineer 模式就看得到（公式標籤、推導、精確／近似標籤、F-04.11 的說明、面板 B）
    const foldOf = (title: string) => texText(Array.from(container.querySelectorAll('details.ch04-fold')).find((d) => (d.querySelector('summary')?.textContent ?? '').includes(title))!)
    expect(texText(container.querySelector('[id="formula-F-04.10"]')!)).toContain('右移 rounding 的平均誤差（輸出 LSB；均勻餘數，half-even 另需「恰好一半」時商 j 的奇偶各半）')
    const roundFold = foldOf('四種 rounding 的平均誤差')
    expect(roundFold).toContain(String.raw`Q_\mathrm{half\,even}:\;\bar\varepsilon=\tfrac12\Bigl[P\bigl(\rho=2^{\ell-1},\,j\text{ 奇}\bigr)-P\bigl(\rho=2^{\ell-1},\,j\text{ 偶}\bigr)\Bigr]\;\xlongequal{\text{奇偶各半}}\;0`)
    expect(roundFold).toContain('只有「餘數均勻」不夠')
    expect(roundFold).toContain(String.raw`例：\ell=2 時 S=0,1,2,3（j=0）的誤差是 0,-\tfrac14,-\tfrac12,+\tfrac14，平均 -\tfrac18；S=4,5,6,7（j=1）是 0,-\tfrac14,+\tfrac12,+\tfrac14，平均 +\tfrac18；兩圈合起來才是 0`)
    expect(roundFold).toContain(String.raw`floor、half-up、toward-0 在「餘數均勻」的前提下精確；half-even 還要「恰好一半」時 j 的奇偶各半才精確為 0，只有餘數均勻時只能保證 |\bar\varepsilon_\mathrm{half\,even}|\le2^{-\ell-1}`)
    expect(roundFold).toContain(String.raw`half-even 剩下的誤差不超過約 0.0072\times2^{-\ell} 個 LSB`)
    // 「σ_S 夠大」是在 S 近似 Gaussian 的前提下說的；只有 RMS 大並不夠（審查的反例：商恆為偶數）
    expect(roundFold).toContain(String.raw`S 是 N 個獨立項的和、近似 Gaussian，\sigma_S\gtrsim2^\ell 時餘數幾乎均勻`)
    expect(roundFold).toContain(String.raw`只有 \sigma_S 大並不夠：把上面例子的 S=0,1,2,3 各加上 8 的任意整數倍，\sigma_S 可以任意大、餘數仍然均勻，但 j 永遠是偶數，half-even 的平均仍是 -\tfrac18`)
    // 清理（R11 的延伸）：toward-0 的平台寬 2 個 LSB，dither 比的下限是其他三種的兩倍（實驗的比對條件與模型的警告用同一個下限）
    expect(roundFold).toContain(String.raw`|S|<2^\ell 全部輸出 0，這個平台寬 2 個 LSB（其他三種是 1 個），所以需要的 dither 比 \sigma_S/2^\ell 是其他三種的兩倍（約 ${2 * DITHER_MIN}，下方實驗的偏差比對與模型的警告用這個下限）`)
    const biasFold = foldOf('閉迴路：平均誤差變成係數偏差')
    expect(biasFold).toContain(String.raw`half-even 的 \delta^*=0 不靠 F-04.10 的「恰好一半」條件：它是奇函數 Q(-S)=-Q(S)`)
    expect(biasFold).toContain(String.raw`dither 不夠（\sigma_S/2^\ell\lesssim${DITHER_MIN}）時 half-even 和 floor 一樣會停在 dead zone`)
    expect(foldOf('第二個截斷點')).toContain('half-even 則為 0（和 F-04.10 一樣，另需恰好一半時商的奇偶各半）')
    const fpShell = texText(shellOf(container, 'gmac-fixed-point'))
    expect(fpShell).toContain(String.raw`half-even \approx0、toward-zero 在 0 附近`) // 面板 B 的圖說
    expect(fpShell).toContain(String.raw`half-even 那一列的 0：除了餘數均勻，還要「恰好一半」時商的奇偶各半（F-04.10）。上圖的離散 Gaussian 模型在 \sigma_S/2^\ell\ge1 時，half-even 的曲線偏離 0 不超過約 0.0072\times2^{-\ell} 個 LSB`)
    expect(fpShell.includes('half-even 為 0')).toBe(false)
    expect(fpShell.includes('（或 half-even）')).toBe(false)
    expect((container.textContent ?? '').includes('這一格的貢獻是')).toBe(false) // Research 的補充在 Engineer 模式不顯示
    // 手算 HC-04.7 的附註：half-even 在閉迴路沒有固定偏差的理由是奇對稱，開迴路的 0 才需要 F-04.10 的條件
    expect(texText(container.querySelector('[id="handcalc-HC-04.7"]')!)).toContain(String.raw`half-even 在閉迴路沒有固定偏差：它是奇函數 Q(-S)=-Q(S)，平衡點 \delta=0 時 S 的分布對 0 對稱，平均輸出就是 0（開迴路的平均誤差為 0 則要 F-04.10 的條件）`)
    // 章末符號表列出商 j
    expect(texText(symbols)).toContain(String.raw`右移留下的商 j=\lfloor S/2^\ell\rfloor 與丟掉的餘數 \rho=S\bmod2^\ell`)
    // 模型警告裡 toward-0 的「回復斜率 χ」在符號表查得到定義（和 floor 的 χ(s) 不是同一個式子）
    expect(texText(symbols)).toContain(String.raw`toward-0 的是 \sum_{k\ne0}\varphi(k/s)/s，同樣的 s 下小得多，所以它需要的 dither 比加倍`)
    // 外部審查 R06b：把 δ_k 寫在 h 外面要 w 在 h 的記憶長度內近似不變（Ch06 的 F-06.1）；式子本身不變
    const hw = foldOf('把迴路走一圈：一階平均模型')
    expect(hw).toContain(String.raw`e[n]=\delta_k\,u[n]+b_\mathrm{off}+v[n],\qquad u[n]=(h*x)[n]`)
    expect(hw).toContain(String.raw`把 \delta_k 寫在 h 外面，是 w 在 h 的記憶長度內近似不變（每個 block 只動一點）時的近似，Ch06 的 F-06.1（h 沒有記憶的 identity path 則是等式）`)
    expect(hw).toContain('雜訊 iid Gaussian 且與 code 獨立、w 在 h 的記憶長度內近似不變（第 1 步）')
    // 清理（R06b）：§4 的小訊號平均在推導旁寫出「w 在 h 的記憶長度內近似不變」這個前提（identity path 時是等式），和 §3 的推導、登錄的 F-04.4 一致
    expect(foldOf(String.raw`E[G_k]\approx K_qC\,\delta_k`)).toContain(
      String.raw`第 3 步的 e=\delta_ku+v 在 PLL 誤差路徑有記憶（u\ne x）時另需 w 在 h 的記憶長度內近似不變（§4 推導的第 1 步，Ch06 的 F-06.1）；identity path（u=x）時是等式`,
    )
    // 清理（R11）：四種取整那張圖的圖說、章末總表的 rounding 那一列、程式碼標題都指出 half-even 的 0 另有條件
    expect(figCaptions.map((c) => texText(c)).join('\n')).toContain(String.raw`再看最下面一排的平均誤差 \bar\varepsilon（餘數均勻時）：floor 偏負（紅色），half-even 為 0（綠色；它還多一個條件，見圖下的說明）`)
    expect(texText(container.querySelector('#ch04-wrap')!)).toContain(String.raw`（餘數均勻時；half-even 的 0 另需「恰好一半」時商的奇偶各半，F-04.10；閉迴路的 \delta^*=0 靠的是奇對稱，不靠這個條件）`)
    expect(Array.from(container.querySelectorAll('.c-code-title')).map((t) => texText(t))).toContain('均勻餘數下的平均誤差（F-04.10 的程式版；half-even 的 0 另需「恰好一半」時商的奇偶各半）')
    // 清理（版面）：比桌機欄寬長的獨立公式排成對齊的兩行（內容不變），不再需要橫向捲軸
    expect(texText(container.querySelector('[id="formula-F-04.9"]')!)).toContain(
      String.raw`\begin{aligned}&\boxed{B_\mathrm{acc}=1+\bigl\lceil\log_2(NM_x+1)\bigr\rceil},\\[4pt]&B_\mathrm{acc}^\mathrm{sym}\le B_x+\lceil\log_2N\rceil\;(N=2^m\text{ 時取等號}),\qquad B_\mathrm{acc}^\mathrm{full}=B_x+\lfloor\log_2N\rfloor+1\end{aligned}`,
    )
    expect(texText(container.querySelector('[id="formula-F-04.6"]')!)).toContain(
      String.raw`\begin{aligned}E[S_N]&=Nm_q=79.7871,&\mathrm{sd}(S_N)&=\sqrt{N(1-m_q^2)}=99.9968;\\E[G]&=m_q=0.00797871,&\mathrm{sd}(G)&=\sqrt{\tfrac{1-m_q^2}{N}}=0.00999968\end{aligned}`,
    )
    // React 不應報錯（key、DOM 巢狀、hooks 規則…）
    expect(errSpy.mock.calls.map((c) => String(c[0]).slice(0, 200))).toEqual([])
    errSpy.mockRestore()
  }, PAGE_TIMEOUT)

  it('Research 模式顯示額外內容（golden Python、Poisson summation）且 TeX 全部可解析；Beginner 模式推導預設收合', () => {
    localStorage.setItem('lmspll.mode', 'research')
    const r = renderAt()
    expect(r.container.textContent).toContain('def accumulator_bits_required')
    expect(r.container.textContent).toContain('Research：dither 不夠時會怎樣？平衡點為什麼不靠「餘數均勻」？')
    expectNoTexErrors(r.container)
    expect(Array.from(r.container.querySelectorAll('details.ch04-fold')).every((d) => (d as HTMLDetailsElement).open)).toBe(true)
    // Research：Part 2 展開、沒有 Beginner 的提示
    expect(r.container.querySelector<HTMLDetailsElement>('details.ch04-part')!.open).toBe(true)
    expect(r.container.querySelector('.ch04-part-hint')).toBeNull()
    // 外部審查 R11：Research 的補充——half-even 的 tie 項（週期是餘數的兩倍）與它的大小
    expect(r.container.textContent).toContain('的奇偶各半才精確為 0')
    expect(r.container.textContent).toContain('half-even 的')
    const researchBox = Array.from(r.container.querySelectorAll('#ch04-fixed .c-callout')).find((c) => (c.querySelector('.c-callout-title')?.textContent ?? '').startsWith('Research：dither 不夠時會怎樣？'))!
    const research = texText(researchBox)
    expect(research).toContain(String.raw`\bar\varepsilon_\mathrm{half\,even}^\mathrm{tie}(m)\approx-2^{-\ell}e^{-\pi^2s^2/2}\sin\pi m`)
    expect(research).toContain(String.raw`s=1 時振幅約 0.0072\times2^{-\ell}（half-up 的 2^{-\ell-1} 的 1.4\%）`)
    expect(research).toContain(String.raw`看的是 S\bmod2^{\ell+1}，週期是餘數的兩倍`)
    expect(research).toContain('dither 不夠時同樣有 dead zone')
    // 清理（版面）：χ(s) 的定義與四個數值分成兩行（原本的 floor 推導與數字不變）
    expect(research).toContain(String.raw`\begin{aligned}\chi(s)&=\frac{dE[\lfloor X\rfloor]}{dm}\Big|_{m=\frac12}=1+2\sum_{k\ge1}(-1)^ke^{-2\pi^2k^2s^2}:\\&\chi(1)=1,\;\chi(0.5)=0.986,\;\chi(0.25)=0.432,\;\chi(0.142)=0.0114\end{aligned}`)
    r.unmount()
    localStorage.setItem('lmspll.mode', 'beginner')
    const b = renderAt()
    const folds = Array.from(b.container.querySelectorAll('details.ch04-fold')) as HTMLDetailsElement[]
    expect(folds.length).toBeGreaterThan(8)
    expect(folds.every((d) => !d.open)).toBe(true)
    expect(b.container.textContent).not.toContain('def accumulator_bits_required')
    // Beginner：Part 2（§4–§7）整段收成一個 details，只留摘要與提示；內容仍在 DOM（公式錨點、手算題、?a= 深連結都找得到）
    const part2 = b.container.querySelector<HTMLDetailsElement>('details.ch04-part')!
    expect(part2.open).toBe(false)
    expect(part2.querySelector('summary')!.textContent).toContain('目前是 Beginner 模式，這一部分預設收合')
    expect(part2.querySelector('[id="handcalc-HC-04.8"]')).not.toBeNull()
    expect(part2.querySelector('[id="formula-F-04.9"]')).not.toBeNull()
    expect(b.container.querySelectorAll('#ch04-part1-quiz .c-quiz').length).toBe(6)
    // Beginner 模式下每個登錄的公式仍有錨點（Formula Reference 頁的連結不會落空），先備知識框也都在
    for (const fm of FORMULAS) expect(b.container.querySelector(`[id="formula-${fm.id}"]`), fm.id).not.toBeNull()
    for (const t of ['Z transform', '期望值', 'Gaussian 分布', 'pole 與單位圓', '二補數']) expect(b.container.textContent).toContain(t)
    // 外部審查 R11：Beginner 模式推導收合，half-even 多出來的條件仍寫在 F-04.10 的標籤與看圖說明裡
    expect(b.container.querySelector('[id="formula-F-04.10"]')!.textContent).toContain('奇偶各半')
    expect(b.container.querySelector('#ch04-fixed')!.textContent).toContain('half-even 平均為 0（另外需要「恰好一半」時')
    b.unmount()
  }, PAGE_TIMEOUT)

  it('?preset=gmac-flow-sum-vs-average 會載入三個 case（A/B/C），切到 B 時顯示 sum 模式的警告；Engineer 模式下 Part 2 展開', async () => {
    localStorage.setItem('lmspll.mode', 'engineer')
    const { container } = renderAt('/ch/04?preset=gmac-flow-sum-vs-average')
    expect(container.querySelector<HTMLDetailsElement>('details.ch04-part')!.open).toBe(true)
    expect(container.querySelector('.ch04-part-hint')).toBeNull()
    await waitFor(() => expect(caseButtons(container, 'gmac-signal-flow').map((b) => b.textContent?.trim())).toEqual(['Case A', 'Case B', 'Case C']), WAIT)
    act(() => caseButtons(container, 'gmac-signal-flow')[1].click())
    // blockLms 的警告是純文字（Unicode 拼的數學），頁面在顯示層轉成 $...$：N、μ/N 都是 KaTeX
    const shell = shellOf(container, 'gmac-signal-flow')
    await waitFor(() => expect(texText(shell)).toContain('Case B：gm_mode=sum 時有效增益放大 N 倍（N=16：g=6.383；若沿用 average 模式的 \\mu，需改為 \\mu/N=0.625）'), WAIT)
    expectNoTexErrors(shell)
    expect(proseText(shell)).not.toContain('$')
    // 假設清單（blockLms 的 assumptions）也轉成 LaTeX；sum 模式的總和寫成 S_k（勘誤 E07 / E18）
    expect(texText(shell)).toContain('K_q=\\sqrt{2/\\pi}/\\sigma_v 為小訊號近似')
    expect(texText(shell)).toContain('GMAC（sum 模式）：S_k=\\sum q\\,x_\\mathrm{ref}（N=16）')
    // 模型原本的 Unicode 寫法不再出現（TestBadge 提示框逐字列出的測試名稱不算，見 proseText）
    expect(proseText(shell)).not.toMatch(/σ_v|x_ref|w\* − a/)
  }, PAGE_TIMEOUT)
})

describe('Ch04 資料與輔助計算', () => {
  it('FORMULAS：ID 唯一、格式 F-04.n、頁面 /ch/04', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-04\.\d+$/)
      expect(f.page).toBe('/ch/04')
      expect(f.tex.length).toBeGreaterThan(5)
    }
  })

  it('FORMULAS 的 title / conditions：數學都寫成 $...$（Formula Reference 頁以 mathText 顯示），每一段都能被 KaTeX 解析', () => {
    const inline = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
    let withMath = 0
    for (const f of FORMULAS) {
      expect(renderTex(f.tex, true), f.id).not.toMatch(/katex-error|c-tex-error/)
      for (const text of [f.title, f.conditions]) {
        for (const m of text.matchAll(inline)) expect(renderTex(m[1], false), `${f.id}：${m[1]}`).not.toMatch(/katex-error|c-tex-error/)
        const plain = text.replace(inline, '')
        expect(plain, `${f.id} 落單的 $`).not.toContain('$')
        // $...$ 之外不可再有 Unicode 拼的數學（σ_v、≤、² …）、底線下標或落單的 TeX 指令
        expect(plain, `${f.id}：${plain}`).not.toMatch(/[σμδΔεχℓπφΦξ≤≥≈≠±∝⇒⇔→√½¼−·×²³∞≪≲≳∈′⌈⌉⌊⌋~]|[A-Za-z]_[A-Za-z{]|\^|\\[A-Za-z]/)
      }
      if (f.conditions.includes('$')) withMath++
    }
    expect(withMath).toBe(FORMULAS.length) // 每一條的使用條件都含有符號
    // 抽查：極性與 tie 規則（勘誤 E07）、F-04.18 的串接式
    expect(FORMULAS.find((f) => f.id === 'F-04.2')!.conditions).toContain(String.raw`$\delta=a-w$`)
    // 架構（全站約定，docs/assumptions.md §2a）：DTC 在 reference 輸入端，延遲從基準延遲 T_0 往回扣補償量；需要的補償量另用 τ_need；殘差的式子不變
    const f042 = FORMULAS.find((f) => f.id === 'F-04.2')!
    expect(f042.tex).toBe(String.raw`\tau_\mathrm{need}[n]=\frac{s[n]}{M}\,T_\mathrm{vco},\qquad\tau_\mathrm{DTC}[n]=T_0-w\,x[n],\qquad e_\mathrm{det}[n]=(a-w)\,x[n]`)
    expect(f042.conditions).toContain('DTC 在 reference 輸入端')
    expect(f042.conditions).toContain(String.raw`從固定的基準延遲 $T_0$ 往回扣補償量 $w\,x[n]$`)
    expect(f042.conditions).toContain('PD 量的是 DTC 延遲後的 reference edge 減 feedback edge')
    expect(FORMULAS.find((f) => f.id === 'F-04.1')!.conditions).toContain('feedback（divider）edge 的累積時間誤差（正 = 晚到）')
    // 符號表：τ_need（需要的補償量）、τ_DTC = T_0 − w_k·x[n]、兩條 edge 的時刻、e[n] 是 PD 的輸出
    const sym = (s: string) => CH04_SYMBOLS.find((r) => r.symbol === s)
    for (const s of [String.raw`\tau_\mathrm{need}[n]`, String.raw`\tau_\mathrm{DTC}[n],\;T_0`, String.raw`t_\mathrm{ref}'[n],\;t_\mathrm{fb}[n]`, String.raw`e_\mathrm{det}[n]`, 'e[n]']) expect(sym(s), s).toBeTruthy()
    expect(FORMULAS.find((f) => f.id === 'F-04.3')!.conditions).toContain(String.raw`$b=1\Leftrightarrow e\ge0$（tie 判 $+1$）`)
    expect(FORMULAS.find((f) => f.id === 'F-04.18')!.conditions).toContain(String.raw`$=-(1-2^{-(\ell+\ell_W)})\,\Delta_W/(2g)$`)
  })

  it('F-04.4（外部審查 R06b）：小訊號平均另需「w 在 h 的記憶長度內近似常數」（identity path 不需要）；式子與 approx 標籤不變', () => {
    const f0404 = FORMULAS.find((f) => f.id === 'F-04.4')!
    expect(f0404.claim).toBe('approx')
    expect(f0404.tex).toBe(String.raw`E[G_k\mid\delta_k]=\frac1N\sum_n x_\mathrm{ref}[n]\,\mathrm{erf}\!\Bigl(\frac{\delta_k u[n]}{\sqrt2\,\sigma_v}\Bigr)\approx K_qC\,\delta_k=K\delta_k`)
    for (const t of [
      String.raw`$v\sim\mathcal N(0,\sigma_v^2)$ iid 且與 code 獨立`,
      String.raw`$|\delta_k u|\ll\sigma_v$（erf 一階泰勒）`,
      String.raw`$u=h*x$（$h$ 為 PLL 誤差路徑 $H_\mathrm{PD}$ 的脈衝響應）`,
      '$w$ 在 $h$ 的記憶長度內近似常數（時間尺度分離，Ch06 的 F-06.1）',
      String.raw`才能把 PD 看到的誤差寫成 $\delta_k\,u[n]$`,
      String.raw`$h$ 沒有記憶的 identity path（$u=x$）不需要這個前提`,
      String.raw`$C=E[x_\mathrm{ref}\,u]$`,
    ])
      expect(f0404.conditions, t).toContain(t)
  })

  it('F-04.10（外部審查 R11）：half-even 的 0 另需「恰好一半」時商的奇偶各半；式子、標籤不變，條件寫在 conditions', () => {
    const f0410 = FORMULAS.find((f) => f.id === 'F-04.10')!
    expect(f0410.claim).toBe('approx')
    expect(f0410.title).toBe('右移 rounding 的平均誤差（均勻餘數）')
    expect(f0410.tex).toContain(String.raw`\bar\varepsilon_\mathrm{half\,even}=0`)
    expect(roundingMeanError(4, 'half_even')).toBe(0)
    for (const t of [
      String.raw`$S=2^\ell j+\rho$`,
      String.raw`餘數 $\rho=S\bmod2^\ell$ 均勻`,
      String.raw`half-even 的 $0$ 另需「恰好一半（$\rho=2^{\ell-1}$）時商 $j$ 的奇偶各半」`,
      String.raw`$S\bmod2^{\ell+1}$ 均勻`,
      '對稱時自動成立',
      String.raw`$\bar\varepsilon_\mathrm{half\,even}=\tfrac12\bigl[P(\rho=2^{\ell-1},\,j\text{ 奇})-P(\rho=2^{\ell-1},\,j\text{ 偶})\bigr]$`,
      String.raw`$|\bar\varepsilon_\mathrm{half\,even}|\le2^{-\ell-1}$`,
      String.raw`toward-zero 為 $-\mathrm{sign}(S)\,(1-2^{-\ell})/2$`,
    ])
      expect(f0410.conditions, t).toContain(t)
    // 閉迴路的敘述（奇對稱 ⇒ δ* = 0）不變：F-04.18 仍寫 half-even 時為 0
    expect(FORMULAS.find((f) => f.id === 'F-04.18')!.conditions).toContain(String.raw`half-even 時為 $0$`)
    // 頁面引用的振幅：e^{−π²/2} ≈ 0.0072（gmac.test.ts 與面板 B 的精確模型比對）
    expect(halfEvenTieAmplitude(1).toPrecision(2)).toBe('0.0072')
    expect((200 * halfEvenTieAmplitude(1)).toPrecision(2)).toBe('1.4')
  })

  it('定點實驗的偏差預測適用條件（外部審查 R11）：half-even 在 dither 不足時也不適用（迴路停在 dead zone）；toward-0 的下限加倍；dither 足夠時照常比對', () => {
    // 反例：half-even、σ_S/2^ℓ = 0.142。平衡點的預測是 0，但迴路從上方接近時停在 +1.6 fs（dead zone），模型同時發出 dead zone 警告
    const c = { ...DEFAULT_FP_CASE, accBits: 20, gFracBits: 0, rounding: 'half_even' as const }
    const shared = { ...DEFAULT_FP_SHARED, log2N: 14, w0: 8 }
    const r = runFixedGmacLoop(buildLoopParams(shared, c, 3))
    expect(r.analytic.ditherRatio).toBeCloseTo(0.142, 3)
    expect(r.analytic.ditherRatio).toBeLessThan(DITHER_MIN)
    expect(r.analytic.biasPred).toBe(0)
    expect(r.stats.biasDiff).toBeGreaterThan(0.5)
    expect(r.stats.biasDiff).toBeGreaterThan(4 * r.stats.biasDiffSe)
    expect(r.stats.biasDiff).toBeCloseTo(1.618, 2) // +1.618 ± 0.025 fs
    expect(r.warnings.join('\n')).toMatch(/dead zone/)
    expect([r.stats.accOverflow, r.stats.wSat, r.stats.wWrap]).toEqual([0, 0, 0]) // 其他適用條件都滿足：只有 dither 這一關擋得住
    expect(r.analytic.linearValid).toBe(true)
    expect(roundingPredictionOk(r.analytic, c)).toBe(false)
    // 從下方接近時停在另一側（−1.67 fs）：不是固定偏差，是 dead zone
    const below = runFixedGmacLoop(buildLoopParams({ ...shared, w0: 0 }, c, 3))
    expect(below.stats.biasDiff).toBeLessThan(-0.5)
    expect(roundingPredictionOk(below.analytic, c)).toBe(false)
    // 同樣的設定改成 floor：原本就不適用（行為不變）
    const fl = { ...c, rounding: 'floor' as const }
    expect(roundingPredictionOk(runFixedGmacLoop({ ...buildLoopParams(shared, fl, 3), numBlocks: 20 }).analytic, fl)).toBe(false)
    // 正常對照：預設的 half-even case（σ_S/2^ℓ = 2.273）適用，模擬與預測 0 相符
    const c2 = { ...DEFAULT_FP_CASE, rounding: 'half_even' as const }
    const ok = runFixedGmacLoop(buildLoopParams(DEFAULT_FP_SHARED, c2, 1))
    expect(ok.analytic.ditherRatio).toBeCloseTo(2.273, 3)
    expect(roundingPredictionOk(ok.analytic, c2)).toBe(true)
    expect(ok.analytic.biasPred).toBe(0)
    expect(Math.abs(ok.stats.biasDiff)).toBeLessThanOrEqual(4 * ok.stats.biasDiffSe + 0.02)
    expect(ok.warnings.join('\n')).not.toMatch(/dead zone/)
    // 第二個取整點同理：W 用 half-even 但 μσ_G/Δ_W 不足時不適用；足夠時適用；sum 模式（不右移）與浮點 W 不受這一關限制
    const an = (ditherRatio: number, ditherRatioW: number, ell = 8) => ({ ell, ditherRatio, ditherRatioW })
    const he = { rounding: 'half_even', wRounding: 'half_even' } as const
    expect(roundingPredictionOk(an(2.273, 0.1), { gmMode: 'average', wLsb: 1.25, ...he })).toBe(false)
    expect(roundingPredictionOk(an(2.273, 1.137), { gmMode: 'average', wLsb: 0.15625, ...he })).toBe(true)
    expect(roundingPredictionOk(an(2.273, DITHER_MIN), { gmMode: 'average', wLsb: 0.15625, ...he })).toBe(true)
    expect(roundingPredictionOk(an(0.1, Infinity), { gmMode: 'average', wLsb: 0, ...he })).toBe(false)
    expect(roundingPredictionOk(an(0.1, Infinity), { gmMode: 'sum', wLsb: 0, ...he })).toBe(true)
    expect(roundingPredictionOk(an(0.1, Infinity, 0), { gmMode: 'average', wLsb: 0, ...he })).toBe(true) // ℓ ≤ 0：沒有右移
    // toward-0：|S| < 2^ℓ 全部輸出 0，0 附近的平台寬 2 個 LSB（floor / half-even 是 1 個），所以 dither 比的下限加倍。
    // 反例：σ_S/2^ℓ = 0.284（已經超過 DITHER_MIN）時迴路仍停在出發的那一側——從下方 −2.64 fs、從上方 +3.21 fs，預測是 0；
    // 模型的 dead zone 警告用同一個下限（gmac.ts 的 ditherMinFor），所以這時也會發出 toward-zero 專屬的警告
    expect([ditherMinFor('floor'), ditherMinFor('half_up'), ditherMinFor('half_even'), ditherMinFor('toward_zero')]).toEqual([DITHER_MIN, DITHER_MIN, DITHER_MIN, 2 * DITHER_MIN])
    const tz = { ...DEFAULT_FP_CASE, accBits: 20, gFracBits: 0, rounding: 'toward_zero' as const }
    const tzBelow = runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, log2N: 12, w0: 0 }, tz, 3))
    const tzAbove = runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, log2N: 12, w0: 8 }, tz, 3))
    expect(tzBelow.analytic.ditherRatio).toBeCloseTo(0.284, 3)
    expect(tzBelow.analytic.ditherRatio).toBeGreaterThan(DITHER_MIN)
    expect([tzBelow.analytic.biasPred, tzAbove.analytic.biasPred]).toEqual([0, 0])
    expect(tzBelow.stats.biasDiff).toBeCloseTo(-2.641, 2) // −2.641 ± 0.096 fs
    expect(tzBelow.stats.biasDiff).toBeLessThan(-4 * tzBelow.stats.biasDiffSe)
    expect(tzAbove.stats.biasDiff).toBeCloseTo(3.209, 2) // +3.209 ± 0.173 fs
    expect(tzAbove.stats.biasDiff).toBeGreaterThan(4 * tzAbove.stats.biasDiffSe)
    for (const res of [tzBelow, tzAbove]) {
      expect([res.stats.accOverflow, res.stats.wSat, res.stats.wWrap]).toEqual([0, 0, 0])
      expect(res.analytic.linearValid).toBe(true)
      expect(roundingPredictionOk(res.analytic, tz)).toBe(false)
      expect(res.warnings.join('\n')).toContain('σ_S/2^ℓ = 0.284 < 0.5（toward-zero 的下限是 floor 的兩倍）')
    }
    // 實驗的「不適用」與模型的 dead zone 警告一致：四種模式 × 三個 dither 比（0.568、0.284、0.142）× 兩個取整點，
    // 取整這一關判成不適用 ⇔ 警告清單裡有 dead zone 的訊息（toward-0 在 0.25 ≤ dither 比 < 0.5 不再只有實驗說 n/a 而模型沒有警告）
    let combos = 0
    for (const mode of ROUNDING_MODES) {
      for (const log2N of [10, 12, 14]) {
        const cc = { ...DEFAULT_FP_CASE, accBits: 20, gFracBits: 0, rounding: mode }
        const res = runFixedGmacLoop({ ...buildLoopParams({ ...DEFAULT_FP_SHARED, log2N }, cc, 3), numBlocks: 10 })
        expect(roundingPredictionOk(res.analytic, cc), `${mode} log2N=${log2N}`).toBe(!/dead zone/.test(res.warnings.join('\n')))
        combos++
      }
      for (const wLsb of [0.3125, 0.625, 1.25]) {
        const cc = { ...DEFAULT_FP_CASE, gFracBits: 4, rounding: 'half_even' as const, wLsb, wRounding: mode }
        const res = runFixedGmacLoop({ ...buildLoopParams(DEFAULT_FP_SHARED, cc, 3), numBlocks: 10 })
        expect(roundingPredictionOk(res.analytic, cc), `W ${mode} Δ_W=${wLsb}`).toBe(!/dead zone/.test(res.warnings.join('\n')))
        combos++
      }
    }
    expect(combos).toBe(24)
    // 單一 seed 的比對標成不相符時附上的提示（AR(1) 標準誤偏小）：純文字、沒有落單的 $
    expect(SINGLE_SEED_HINT).toContain('Monte Carlo')
    expect(SINGLE_SEED_HINT).not.toContain('$')
    // 對照：同樣的設定下 floor 與 half-even 適用，而且和各自的預測相符（平台只有 1 個 LSB 寬）
    for (const rounding of ['floor', 'half_even'] as const) {
      const cc = { ...tz, rounding }
      const res = runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, log2N: 12, w0: 8 }, cc, 3))
      expect(roundingPredictionOk(res.analytic, cc), rounding).toBe(true)
      expect(Math.abs(res.stats.biasDiff - res.analytic.biasPred), rounding).toBeLessThanOrEqual(4 * res.stats.biasDiffSe + 0.05 * Math.abs(res.analytic.biasPred))
    }
    // 正常對照：預設的 dither（σ_S/2^ℓ = 2.273）下 toward-0 適用，模擬與預測 0 相符
    const tz2 = { ...DEFAULT_FP_CASE, rounding: 'toward_zero' as const }
    const tzOk = runFixedGmacLoop(buildLoopParams(DEFAULT_FP_SHARED, tz2, 1))
    expect(roundingPredictionOk(tzOk.analytic, tz2)).toBe(true)
    expect(Math.abs(tzOk.stats.biasDiff)).toBeLessThanOrEqual(4 * tzOk.stats.biasDiffSe + 0.02)
    // 門檻的兩側、兩個取整點
    expect(roundingPredictionOk(an(0.49, Infinity), { gmMode: 'average', wLsb: 0, rounding: 'toward_zero', wRounding: 'half_even' })).toBe(false)
    expect(roundingPredictionOk(an(0.5, Infinity), { gmMode: 'average', wLsb: 0, rounding: 'toward_zero', wRounding: 'half_even' })).toBe(true)
    expect(roundingPredictionOk(an(2.273, 0.284), { gmMode: 'average', wLsb: 0.625, rounding: 'half_even', wRounding: 'toward_zero' })).toBe(false)
    expect(roundingPredictionOk(an(2.273, 0.284), { gmMode: 'average', wLsb: 0.625, rounding: 'half_even', wRounding: 'floor' })).toBe(true)
    expect(roundingPredictionOk(an(2.273, 0.568), { gmMode: 'average', wLsb: 0.3125, rounding: 'half_even', wRounding: 'toward_zero' })).toBe(true)
    expect(roundingPredictionOk(an(0.284, Infinity), { gmMode: 'sum', wLsb: 0, rounding: 'toward_zero', wRounding: 'toward_zero' })).toBe(true) // sum 模式不右移、浮點 W 不取整
    // 本章附的定點 preset 全部維持適用（half-even 的 case 都有足夠的 dither）：比對結果不因為這個條件改變
    const dir = join(process.cwd(), 'src', 'data', 'presets')
    let checked = 0
    for (const file of readdirSync(dir).filter((f) => /^gmac-fp-.*\.json$/.test(f))) {
      const p = JSON.parse(readFileSync(join(dir, file), 'utf8')) as PresetEntry
      if (p.experiment !== 'gmac-fixed-point') continue
      const { cases, seed, ...sh } = p.params as { cases: Partial<typeof DEFAULT_FP_CASE>[]; seed: number }
      for (const cs of cases) {
        const cc = { ...DEFAULT_FP_CASE, ...cs }
        const res = runFixedGmacLoop({ ...buildLoopParams({ ...DEFAULT_FP_SHARED, ...sh }, cc, seed), numBlocks: 20 })
        expect(roundingPredictionOk(res.analytic, cc), `${file} ${JSON.stringify(cs)}`).toBe(true)
        checked++
      }
    }
    expect(checked).toBe(14)
  }, 60000)

  it('presets：本章三個實驗的 preset 都在 /ch/04，參數鍵都是實驗認得的欄位', () => {
    const dir = join(process.cwd(), 'src', 'data', 'presets')
    const known: Record<string, { shared: string[]; cases?: string[]; seeded: boolean }> = {
      'gmac-signal-flow': { shared: Object.keys(DEFAULT_FLOW_SHARED), cases: Object.keys(DEFAULT_FLOW_CASE), seeded: true },
      'gmac-fixed-point': { shared: Object.keys(DEFAULT_FP_SHARED), cases: Object.keys(DEFAULT_FP_CASE), seeded: true },
      'gmac-bit-encoding': { shared: Object.keys(DEFAULT_ENCODING), seeded: true },
      'gmac-residue': { shared: Object.keys(DEFAULT_RESIDUE), seeded: false }, // 確定性序列，沒有 seed
    }
    // gmac-*.json 也有其他頁面（例如 /models 的 gmac-datapath-sizing）的 preset：只檢查本章實驗的
    const files = readdirSync(dir)
      .filter((f) => /^gmac-.*\.json$/.test(f))
      .filter((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as PresetEntry).experiment in known)
    expect(files.length).toBe(14)
    for (const f of files) {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8')) as PresetEntry
      expect(p.id).toBe(f.replace(/\.json$/, ''))
      expect(p.page).toBe('/ch/04')
      const k = known[p.experiment]
      expect(k).toBeTruthy()
      const { cases, seed, ...rest } = p.params as { cases?: Record<string, unknown>[]; seed?: number }
      expect(typeof seed).toBe(k.seeded ? 'number' : 'undefined')
      for (const key of Object.keys(rest)) expect(k.shared).toContain(key)
      if (cases) for (const c of cases) for (const key of Object.keys(c)) expect(k.cases).toContain(key)
      expect(p.expected.length).toBeGreaterThan(10)
    }
  })

  it('preset gmac-residue-*：expected 的數字由 residue.ts / dsm.ts 支持', () => {
    const run = (id: string) => {
      const p = loadPreset(id)
      const prm = { ...DEFAULT_RESIDUE, ...(p.params as Partial<typeof DEFAULT_RESIDUE>) }
      const sig = residueSignals(prm)
      return { sig, maxResid: sig.residualFs.reduce((a, v) => Math.max(a, Math.abs(v)), 0), maxNeed: Math.max(...sig.dtcNeedFs), minNeed: Math.min(...sig.dtcNeedFs) }
    }
    const hand = run('gmac-residue-hand-example')
    expect([hand.sig.K, hand.sig.M, hand.sig.period]).toEqual([5, 16, 16])
    expect(hand.sig.residueRange).toEqual([-0.9375, 0])
    expect(hand.minNeed).toBe(0)
    expect(Object.is(hand.minNeed, -0)).toBe(false) // 不顯示 −0
    expect(hand.maxNeed).toBeCloseTo(72115.38, 2)
    expect(hand.maxResid).toBeCloseTo(721.15, 2)
    const mash = run('gmac-residue-mash111')
    expect([mash.sig.K, mash.sig.M]).toEqual([1229, 4096])
    expect(mash.sig.fracEff).toBeCloseTo(0.30004883, 8)
    expect(mash.sig.residueRange[0]).toBeCloseTo(-1.814, 3)
    expect(mash.sig.residueRange[1]).toBeCloseTo(1.889, 3)
    expect(mash.minNeed).toBeLessThan(0) // 需要 DTC offset
    expect(Math.round(mash.maxResid)).toBe(1453)
    const zero = run('gmac-residue-integer-fcw')
    expect(zero.sig.K).toBe(0)
    expect(Array.from(zero.sig.y).every((v) => v === 0)).toBe(true)
    expect(zero.maxResid).toBe(0)
  })

  it('preset gmac-flow-sum-vs-average 的 expected 由模擬支持：B 振盪、C 與 A 重合', () => {
    const p = JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'presets', 'gmac-flow-sum-vs-average.json'), 'utf8')) as PresetEntry
    const { cases, seed, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
    const s = { ...DEFAULT_FLOW_SHARED, ...shared }
    const [a, b, c] = cases.map((cs) => runBlockLms(flowConfig(s, cs, seed)))
    expect(Array.from(c.blocks.w)).toEqual(Array.from(a.blocks.w))
    expect(b.analytic.g).toBeCloseTo(16 * a.analytic.g, 10)
    expect(Math.max(...b.blocks.w) - Math.min(...b.blocks.w.subarray(4))).toBeGreaterThan(100)
    // expected 文字：「w 在 −40 與 120 fs 之間來回跳」「g ≈ 6.38、pole ≈ −5.4」
    expect(Array.from(new Set(b.blocks.w.subarray(4))).sort((x, y) => x - y)).toEqual([-40, 120])
    expect(b.analytic.g).toBeCloseTo(6.38, 2)
    expect(b.analytic.p).toBeCloseTo(-5.38, 2)
  })

  it('preset gmac-flow-unmapped-dsm：code 全 ≤ 0 + 忘了映射 ⇒ 每個 G ≤ 0、w 單調下降；正確映射時收斂到 a', () => {
    const p = JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'presets', 'gmac-flow-unmapped-dsm.json'), 'utf8')) as PresetEntry
    const { cases, seed, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
    const s = { ...DEFAULT_FLOW_SHARED, ...shared }
    const bug = runBlockLms(flowConfig(s, cases[0], seed))
    expect(Math.max(...bug.trace.xRef)).toBeLessThanOrEqual(0)
    for (const g of bug.blocks.G) expect(g).toBeLessThanOrEqual(0)
    for (let k = 1; k < bug.blocks.w.length; k++) expect(bug.blocks.w[k]).toBeLessThanOrEqual(bug.blocks.w[k - 1])
    expect(bug.metrics.meanW).toBeLessThan(-15)
    const good = runBlockLms(flowConfig({ ...s, encoding: 'bipolar_pm_one' }, cases[0], seed))
    expect(Math.abs(good.metrics.meanW - s.aTrue)).toBeLessThan(2)
  })

  it('preset gmac-fp-6bit-4096：開機時 17-bit wrap 讓 w 往反方向跑，18-bit 與 17-bit saturate 收斂', () => {
    const p = JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'presets', 'gmac-fp-6bit-4096.json'), 'utf8')) as PresetEntry
    const { cases, seed, ...shared } = p.params as { cases: Partial<typeof DEFAULT_FP_CASE>[]; seed: number }
    const [ok, wrap, sat] = cases.map((c) => runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, ...shared }, { ...DEFAULT_FP_CASE, ...c }, seed)))
    expect(ok.stats.accOverflow).toBe(0)
    expect(Math.abs(ok.stats.meanFixed - 3)).toBeLessThan(1)
    expect(wrap.stats.accOverflow).toBeGreaterThanOrEqual(300)
    expect(wrap.wFixedApplied[300]).toBeLessThan(-450)
    expect(sat.stats.accOverflow).toBeGreaterThan(0)
    expect(Math.abs(sat.stats.meanFixed - 3)).toBeLessThan(1)
  }, 30000)

  it('gmac-signal-flow 的解析交叉比對：各 preset × 多 seed，聚合 |z| ≤ 4 且 gmac.ts 重算與 blockLms 逐 block 相同', () => {
    let worst = 0
    for (const id of ['gmac-flow-basic', 'gmac-flow-sum-vs-average', 'gmac-flow-dsm-residue', 'gmac-flow-unmapped-dsm']) {
      const p = loadPreset(id)
      const { cases, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
      const s = { ...DEFAULT_FLOW_SHARED, ...shared }
      for (const c of cases) {
        for (let seed = 1; seed <= 8; seed++) {
          for (const sh of [s, { ...s, N: 1 }, { ...s, path: 'first_order_hp' as const }]) {
            const r = runBlockLms(flowConfig(sh, c, seed))
            const chk = flowAnalyticCheck(r, sh, c.gmMode)
            expect(chk.maxImpl).toBeLessThanOrEqual(1e-9)
            worst = Math.max(worst, Math.abs(chk.aggZ))
          }
        }
      }
    }
    expect(worst).toBeLessThan(4)
  }, 60000)

  it('gmac-signal-flow 的 Monte Carlo 交叉比對：各 preset 的 |z| ≤ 4；把條件平均的模型故意弄錯（a、編碼、σ_v）時能被抓到', () => {
    for (const id of ['gmac-flow-basic', 'gmac-flow-sum-vs-average', 'gmac-flow-dsm-residue', 'gmac-flow-unmapped-dsm']) {
      const p = loadPreset(id)
      const { cases, seed, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
      const s = { ...DEFAULT_FLOW_SHARED, ...shared }
      for (const c of cases) {
        const mc = flowMonteCarlo(s, c, seed)
        expect(mc.runs).toBe(FLOW_MC_RUNS)
        expect(mc.failed).toBe(0)
        expect(mc.blocks).toBe(FLOW_MC_RUNS * s.numBlocks)
        expect(Math.abs(mc.z), `${id} ${c.gmMode}`).toBeLessThan(4)
      }
    }
    // 同一批 seed 可重現
    expect(flowMonteCarlo(DEFAULT_FLOW_SHARED, DEFAULT_FLOW_CASE, 7).z).toBe(flowMonteCarlo(DEFAULT_FLOW_SHARED, DEFAULT_FLOW_CASE, 7).z)
    // 反面測試：解析那一側故意用錯的模型，z 必須遠超過門檻（a 差 10 fs、把 ±1 當成忘了映射、σ_v 差 4 倍）
    const zWith = (wrong: Partial<typeof DEFAULT_FLOW_SHARED>): number => {
      let sumDiff = 0
      let sumVar = 0
      for (let seed = 1; seed <= FLOW_MC_RUNS; seed++) {
        const r = runBlockLms(flowConfig(DEFAULT_FLOW_SHARED, DEFAULT_FLOW_CASE, seed))
        const chk = flowAnalyticCheck(r, { ...DEFAULT_FLOW_SHARED, ...wrong }, 'average')
        sumDiff += chk.sumDiff
        sumVar += chk.sumVar
      }
      return sumDiff / Math.sqrt(sumVar)
    }
    expect(Math.abs(zWith({}))).toBeLessThan(4)
    expect(zWith({ aTrue: DEFAULT_FLOW_SHARED.aTrue + 10 })).toBeLessThan(-20)
    expect(zWith({ aTrue: DEFAULT_FLOW_SHARED.aTrue - 10 })).toBeGreaterThan(20)
    expect(Math.abs(zWith({ encoding: 'unipolar_unmapped_bug' }))).toBeGreaterThan(8)
    expect(Math.abs(zWith({ sigmaV: 4 * DEFAULT_FLOW_SHARED.sigmaV }))).toBeGreaterThan(5)
    // σ_v = 0：G 為確定值，差值必須恰為 0
    expect(flowMonteCarlo({ ...DEFAULT_FLOW_SHARED, sigmaV: 0 }, DEFAULT_FLOW_CASE, 3).z).toBe(0)
  }, 60000)

  it('preset gmac-flow-basic / gmac-flow-dsm-residue 的 expected 由模擬支持（K、g、pole、收斂到 a）', () => {
    for (const id of ['gmac-flow-basic', 'gmac-flow-dsm-residue']) {
      const p = loadPreset(id)
      const { cases, seed, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
      const s = { ...DEFAULT_FLOW_SHARED, ...shared }
      const r = runBlockLms(flowConfig(s, cases[0], seed))
      if (id === 'gmac-flow-basic') {
        expect(r.analytic.K).toBeCloseTo(Math.sqrt(2 / Math.PI) / 20, 10)
        expect(r.analytic.g).toBeCloseTo(0.399, 3)
        expect(r.analytic.p).toBeCloseTo(0.601, 3)
        expect(Math.abs(r.blocks.w[10] - 30)).toBeLessThan(5)
        expect(Math.abs(r.metrics.meanW - 30)).toBeLessThan(2)
        expect(r.metrics.stdW).toBeLessThan(5)
      } else {
        const xr = Array.from(r.trace.xRef)
        const Ex = xr.reduce((a, v) => a + v, 0) / xr.length
        const Ex2 = xr.reduce((a, v) => a + v * v, 0) / xr.length
        expect(Math.max(...xr)).toBeLessThanOrEqual(0)
        expect(Ex).toBeCloseTo(-0.45, 2)
        expect(Ex2).toBeCloseTo(0.285, 2)
        expect(r.analytic.g).toBeCloseTo(0.114, 3)
        expect(Math.abs(r.metrics.meanW - 29.7)).toBeLessThan(0.5)
      }
    }
  })

  it('preset gmac-fp-floor-bias / gmac-fp-negate-bug / gmac-fp-antiwindup 的 expected 由模擬支持', () => {
    const run = (id: string) => {
      const p = loadPreset(id)
      const { cases, seed, ...shared } = p.params as { cases: Partial<typeof DEFAULT_FP_CASE>[]; seed: number }
      return cases.map((c) => runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, ...shared }, { ...DEFAULT_FP_CASE, ...c }, seed)))
    }
    const [fA, fB, fC] = run('gmac-fp-floor-bias')
    // preset expected：「A ≈ −1.59 ± 0.05 fs（預測 −1.51）；B ≈ 0；C ≈ −0.39 ± 0.02 fs（預測 −0.373）」
    expect(fA.stats.biasDiff).toBeCloseTo(-1.59, 2)
    expect(fA.stats.biasDiffSe).toBeGreaterThan(0.04)
    expect(fA.stats.biasDiffSe).toBeLessThan(0.055)
    expect(fA.analytic.biasPred).toBeCloseTo(-1.51, 2)
    expect(Math.abs(fB.stats.biasDiff)).toBeLessThan(4 * fB.stats.biasDiffSe)
    expect(fC.stats.biasDiff).toBeCloseTo(-0.39, 2)
    expect(fC.stats.biasDiffSe).toBeGreaterThan(0.012)
    expect(fC.stats.biasDiffSe).toBeLessThan(0.025)
    expect(fC.analytic.biasPred).toBeCloseTo(-0.373, 3)
    const [nA, nB] = run('gmac-fp-negate-bug')
    expect(Math.abs(nA.stats.biasDiff)).toBeLessThan(4 * nA.stats.biasDiffSe + 0.02)
    // §5.4 的頁面文字：「模擬值約 −6.08 ± 0.09 fs」；preset expected：「約 −6.1 fs（自洽預測 −6.16；近似 −5.87）」
    expect(nB.stats.biasDiff).toBeCloseTo(-6.08, 2)
    expect(nB.stats.biasDiffSe).toBeGreaterThan(0.085)
    expect(nB.stats.biasDiffSe).toBeLessThan(0.095)
    expect(nB.analytic.biasPred).toBeCloseTo(-6.16, 2)
    expect(-negateBugNumbers().approx).toBeCloseTo(-5.87, 2)
    expect(Math.abs(nB.stats.biasDiff - nB.analytic.biasPred)).toBeLessThan(4 * nB.stats.biasDiffSe)
    const [wA, wB, wC] = run('gmac-fp-antiwindup')
    expect(Math.max(...wA.wFixed)).toBe(32)
    // §5.5 的頁面文字與 preset expected：「模擬約 243 blocks（預測約 242），anti-windup 只要約 7 blocks」
    expect(wA.stats.recoveryFixed).toBe(243)
    expect(wA.stats.recoveryPredFixed).toBeCloseTo(242.03, 2)
    expect(wB.stats.recoveryFixed).toBe(7)
    expect(wC.stats.wWrap).toBe(1)
    expect(Math.min(...wC.wFixedApplied.subarray(0, 250))).toBe(0) // rail 到 rail
    // 頁面文字的數字
    expect(windupNumbers().unwind).toBeCloseTo(232.9, 1)
    expect(-negateBugNumbers().deltaStar).toBeCloseTo(nB.analytic.biasPred, 9)
  }, 60000)

  it('preset gmac-fp-w-truncation 與 §5.6 的數字：W floor 的偏差 ≈ ε̄_WΔ_W/g，half-even 與浮點 W 無偏差', () => {
    const p = loadPreset('gmac-fp-w-truncation')
    const { cases, seed, ...shared } = p.params as { cases: Partial<typeof DEFAULT_FP_CASE>[]; seed: number }
    const [a, b, c] = cases.map((cs) => runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, ...shared }, { ...DEFAULT_FP_CASE, ...cs }, seed)))
    // expected：「A ≈ 0；B ≈ −2.58 ± 0.07 fs（預測 −2.653）；C ≈ 0」
    expect(Math.abs(a.stats.biasDiff)).toBeLessThan(4 * a.stats.biasDiffSe + 0.02)
    expect(a.analytic.biasPred).toBe(0)
    expect(b.stats.biasDiff).toBeCloseTo(-2.58, 2)
    expect(b.stats.biasDiffSe).toBeGreaterThan(0.065)
    expect(b.stats.biasDiffSe).toBeLessThan(0.075)
    expect(b.analytic.biasPred).toBeCloseTo(-2.653, 3)
    expect(Math.abs(b.stats.biasDiff - b.analytic.biasPred)).toBeLessThan(4 * b.stats.biasDiffSe)
    expect(Math.abs(c.stats.biasDiff)).toBeLessThan(4 * c.stats.biasDiffSe + 0.02)
    expect(c.analytic.biasPred).toBe(0)
    // 頁面 §5.6 的手算數字與模型的 analytic 相同
    const wt = wTruncNumbers()
    expect(wt.wLsb).toBe(0.15625)
    expect(wt.R).toBe(8)
    expect(wt.bias).toBeCloseTo(b.analytic.biasPred, 10)
    expect(wt.g).toBeCloseTo(b.analytic.g, 12)
    expect(wt.ditherW).toBeCloseTo(b.analytic.ditherRatioW, 10)
    const halfMu = runFixedGmacLoop({ ...buildLoopParams({ ...DEFAULT_FP_SHARED, ...shared, mu: 5 }, { ...DEFAULT_FP_CASE, ...cases[1] }, seed), numBlocks: 20 })
    expect(wt.biasHalf).toBeCloseTo(halfMu.analytic.biasPred, 10)
    expect(wt.biasHalf).toBeCloseTo(-5.685, 3) // preset expected 的「−5.685 fs」
    expect(wt.Rhalf).toBe(16)
    // 設計規則：Δ_W ≤ 2g·δ_tol = 0.00515 fs ⇒ 0.125 fs 的實體 LSB 下面至少 5 個小數位元
    expect(wt.wLsbMax).toBeCloseTo(0.00515, 5)
    expect(wt.fracBits).toBe(5)
  }, 60000)

  it('preset gmac-encoding-dc-code / gmac-encoding-zero-mean 的 expected 由模擬支持', () => {
    for (const id of ['gmac-encoding-dc-code', 'gmac-encoding-zero-mean']) {
      const p = loadPreset(id)
      const { seed, ...rest } = p.params as Record<string, number>
      const r = compareEncodings({ ...DEFAULT_ENCODING, ...rest, seed })
      const [good, mapped, bug] = r.runs
      expect(Array.from(mapped.w)).toEqual(Array.from(good.w))
      expect(Math.abs(good.meanW - 3)).toBeLessThan(4 * ar1MeanSe(good.w.subarray(750), good.meanW))
      expect(bug.K / good.K).toBeCloseTo(0.5, 12)
      const se = ar1MeanSe(bug.w.subarray(750), bug.meanW)
      expect(Math.abs(bug.meanW - r.bugExactPred)).toBeLessThan(4 * se)
      if (id === 'gmac-encoding-dc-code') {
        expect(r.bugExactPred).toBeCloseTo(63.23, 2)
        expect(r.bugLinearPred).toBeCloseTo(53.1, 1)
      } else expect(r.bugExactPred).toBe(3)
    }
  }, 60000)

  it('Part 1 思考題的數字都由模型函式算出：code 的範圍與平均、r[3]、兩拍的補償量、GMAC 的 N_min、1% 收斂的 block 數', () => {
    const n = part1QuizNumbers()
    // 思考題 1：K_F = 5、M = 16 互質 ⇒ 一個週期走遍 0…15，平均 (M − 1)/(2M) = 15/32
    expect(n.M).toBe(16)
    expect([...n.sVals].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i))
    expect(n.sVals.slice(0, 5)).toEqual(firstOrderAccumulator(HAND.KF, HAND.bits, 5).map((r) => r.s))
    expect(n.xMean).toBe(15 / 32)
    expect(n.xMax).toBe(15 / 16)
    // 思考題 2：3-bit、K_F = 3 的 r[3] = −0.5（原思考題 4）
    expect(n.r3.map((r) => r.s)).toEqual([3, 6, 1, 4])
    expect(n.r3[3].residue).toBe(-0.5)
    // 思考題 3：f_vco = 13 GHz，前兩拍需要的補償量 5/16、10/16 個 T_vco（與 preset gmac-residue-hand-example 同一個函式）
    expect(n.tvco).toBeCloseTo(1e6 / 13, 6)
    expect(n.need0).toBeCloseTo((5 / 16) * n.tvco, 6)
    expect(n.need1).toBeCloseTo((10 / 16) * n.tvco, 6)
    expect(n.need1 - n.need0).toBeCloseTo(24038.46, 2)
    // 思考題 4：m_q = erf(0.01/√2)（F-04.6 的例子）；N m_q ≥ √(N(1 − m_q²)) ⇔ N ≥ (1 − m_q²)/m_q²
    expect(n.mq).toBeCloseTo(erf(0.01 / Math.SQRT2), 15)
    expect(n.mq).toBeCloseTo(0.00797871, 8)
    expect(n.nMin).toBe(15708)
    expect(n.nMin * n.mq).toBeGreaterThanOrEqual(Math.sqrt(n.nMin * (1 - n.mq * n.mq)))
    expect((n.nMin - 1) * n.mq).toBeLessThan(Math.sqrt((n.nMin - 1) * (1 - n.mq * n.mq)))
    // 思考題 5：§3 表格 N = 256 那一列（sumAverageTable）；p^k = 0.01 ⇒ k = ⌈ln 0.01 / ln p⌉；μ 減半約兩倍
    const row = sumAverageTable({ mu: 10, sigmaV: 100, C: 1, Ex2: 1, Ns: [256] })[0]
    expect(n.row.gAvg).toBe(row.gAvg)
    expect(n.row.poleAvg).toBeCloseTo(0.9202115, 6) // p = 1 − 10·√(2/π)/100
    expect(QUIZ_SETTLE_RATIO).toBe(0.01)
    expect(n.k1).toBe(56)
    expect(n.k1).toBe(Math.ceil(Math.log(0.01) / Math.log(row.poleAvg)))
    expect(n.kExact).toBeCloseTo(55.38, 2)
    expect(row.poleAvg ** n.k1).toBeLessThanOrEqual(0.01)
    expect(row.poleAvg ** (n.k1 - 1)).toBeGreaterThan(0.01)
    expect(n.k1Half).toBe(114)
    expect(n.rowHalf.gAvg).toBeCloseTo(row.gAvg / 2, 12)
    expect(n.tau).toBeCloseTo(1 / row.gAvg, 12)
  })

  it('手算 GMAC 例子：S = 2、G = 0.5、w_avg = 2、w_sum = 5、G_bug = 0.25', () => {
    const h = handGmac()
    expect(h.Ssum).toBe(2)
    expect(h.G).toBe(0.5)
    expect(h.wAvg).toBe(2)
    expect(h.wSum).toBe(5)
    expect(h.Gbug).toBe(0.25)
    expect(Array.from(h.S)).toEqual([1, 2, 1, 2])
  })

  it('golden Python 片段擷取完整（含三個函式、不含其他段落）', () => {
    const src = readFileSync(join(process.cwd(), 'golden', 'lms_pll_golden', 'quantization.py'), 'utf8')
    const s = sliceGoldenGmac(src)
    expect(s.startsWith('def accumulator_bits_required')).toBe(true)
    expect(s).toMatch(/def wrap_twos_complement/)
    expect(s).toMatch(/def gmac_accumulate/)
    expect(s).toMatch(/return acc$/)
  })

  it('floor 偏差表：F_G 每加 2 bits，偏差約縮小 4 倍；預設例子 −1.51 fs', () => {
    const r2 = defaultBiasNumbers(2)
    const r4 = defaultBiasNumbers(4)
    expect(r2.deltaStar).toBeCloseTo(1.5101835229434817, 10)
    expect(r2.deltaStar / r4.deltaStar).toBeCloseTo(4 * (1 - 2 ** -8) / (1 - 2 ** -6), 10)
    // F_G = 0：dither 比 0.568 < 1，但預測仍可用（gmac.test.ts 的多 seed：−6.13 ± 0.04 vs −6.059）；回復斜率 χ ≈ 0.997
    const r0 = defaultBiasNumbers(0)
    expect(r0.ditherRatio).toBeCloseTo(0.568, 3)
    expect(r0.deltaStar).toBeCloseTo(6.059, 3)
    expect(r0.rho).toBeGreaterThan(0.99)
    expect(r2.rho).toBeCloseTo(1, 9)
  })

  it('忘了清除 S：二階遞迴 |z| = 1（0 < g < 4），平均誤差不衰減；正確時幾何衰減', () => {
    const r = clearVsNoClear(0.2, 200)
    expect(r.radius).toBeCloseTo(1, 12)
    expect(Math.abs(r.clear[200])).toBeLessThan(1e-15)
    const tail = r.noClear.slice(150).map(Math.abs)
    expect(Math.max(...tail)).toBeGreaterThan(0.5)
    // 與 δ_{k+1} − (2 − g)δ_k + δ_{k−1} = 0 一致
    for (let k = 1; k < 199; k++) expect(r.noClear[k + 1] - (2 - 0.2) * r.noClear[k] + r.noClear[k - 1]).toBeCloseTo(0, 10)
  })
})
