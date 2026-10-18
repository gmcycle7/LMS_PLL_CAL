/**
 * 公式頁表格版面的 CSS 約定（formulas.css；jsdom 不做版面，所以直接檢查樣式文字，防止之後不小心改回去）。
 *
 * 背景（visual 審查）：1280px 視窗時，公式登錄表 1291px、符號表 1659px、附錄 A 速查表 1537px，都放在 911px 的內容欄裡，
 * 最右邊的「標籤」「規格」被切在畫面外、沒有任何提示；sticky 的搜尋區占 165px（含 52px 的 topbar）、表頭不 sticky。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/pages/formulas/formulas.css'), 'utf8')
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
/** 取某個選擇器（完整字串，含前後的逗號分隔選擇器）的宣告區塊；找不到回傳空字串 */
const rule = (selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(noComments)?.[1] ?? ''
}

describe('公式登錄表：不橫向捲動、表頭 sticky', () => {
  it('外框不是捲動容器（overflow: visible），表頭 position: sticky 才會相對於視窗；top 是 topbar + 搜尋列的實際高度', () => {
    expect(rule('.fr .fr-reg-wrap')).toMatch(/overflow:\s*visible/)
    const th = rule('.fr-sticky-head thead th')
    expect(th).toMatch(/position:\s*sticky/)
    expect(th).toMatch(/top:\s*calc\(var\(--topbar-h,\s*52px\)\s*\+\s*var\(--fr-search-h,\s*50px\)\)/)
    // 搜尋列（z-index 5）要在表頭（z-index 3）之上
    expect(Number(/z-index:\s*(\d+)/.exec(th)?.[1])).toBeLessThan(Number(/z-index:\s*(\d+)/.exec(rule('.fr-search'))?.[1]))
  })

  it('固定版面：table-layout: fixed、width: 100%、左欄固定寬度；sticky 表頭用 border-collapse: separate（collapse 時 sticky 表頭的格線會留在原地）', () => {
    const t = rule('.fr-reg-table')
    expect(t).toMatch(/table-layout:\s*fixed/)
    expect(t).toMatch(/width:\s*100%/)
    expect(rule('.fr-reg-table thead th:nth-child(1)')).toMatch(/width:\s*[\d.]+rem/)
    expect(rule('.fr-sticky-head')).toMatch(/border-collapse:\s*separate/)
    expect(rule('.fr-sticky-head th,\n.fr-sticky-head td')).toMatch(/border-width:\s*0 1px 1px 0/)
  })

  it('符號表與速查表的 sticky 表頭：外框（TableWrap）放得下時 overflow: visible，溢位 1–6px 時隱藏捲軸（寫在 tiny 之後才會贏）', () => {
    expect(rule(".fr-fade[data-fit='1'] > .fr-sticky-wrap")).toMatch(/overflow:\s*visible/)
    expect(rule(".fr-fade[data-tiny='1'] > .c-scroll")).toMatch(/overflow-x:\s*hidden/)
    expect(noComments.indexOf(".fr-fade[data-fit='1'] > .fr-sticky-wrap")).toBeGreaterThan(noComments.indexOf(".fr-fade[data-tiny='1'] > .c-scroll"))
  })

  it('放不下、外框成為橫向捲動容器時，sticky 表頭回到正常位置（否則 top 的偏移會把表頭推下去、蓋住前幾列）', () => {
    expect(rule(".fr-fade:not([data-fit='1']) .fr-sticky-head thead th")).toMatch(/position:\s*static/)
  })

  it('列印：sticky 表頭回到正常位置（搜尋列也是）；列印沒有捲動，黏住的表頭只會在每頁上緣重疊', () => {
    const print = noComments.slice(noComments.indexOf('@media print {'))
    expect(print).toMatch(/\.fr-sticky-head thead th \{\s*position:\s*static;\s*box-shadow:\s*none;/)
    expect(print).toMatch(/\.fr-search \{\s*position:\s*static;/)
  })

  it('公式欄不再有「至少 26em」的下限（那是六欄時代讓條件有地方換行用的，正是它把表撐成內容欄的 1.4 倍）', () => {
    expect(rule('.fr-reg-formula')).not.toMatch(/min-width:\s*min\(26em/)
    expect(noComments).not.toMatch(/26em/)
  })

  it('卡片檢視（RegistrySection 依容器寬度加 .fr-cards）：登錄表不受 ≤ 640px 的全域卡片規則牽制，欄位名稱不重複印', () => {
    const mobile = noComments.slice(noComments.indexOf('@media (max-width: 640px) {'), noComments.indexOf('@media print'))
    expect(mobile).toMatch(/\.fr \.fr-table:not\(\.fr-reg-table\),/)
    expect(mobile).not.toMatch(/\.fr \.fr-table(?!:not)/) // 每一條都排除登錄表，否則讀者按「表格檢視」在手機上也會被強制成卡片
    expect(rule('.fr .fr-cards .fr-reg-table td[data-label]::before')).toMatch(/display:\s*none/)
  })
})

describe('搜尋列：一列、不占太高', () => {
  it('flex-wrap 的一列（搜尋框 + 目錄），內容欄放不下時目錄才換行；沒有第二層 .fr-search-meta', () => {
    expect(rule('.fr-search-row')).toMatch(/flex-wrap:\s*wrap/)
    expect(noComments).not.toMatch(/\.fr-search-meta/)
    // 垂直 padding 加起來不超過 16px：一列約 52px（原本 113px）
    const pad = /padding:\s*(\d+)px\s+0/.exec(rule('.fr-search'))
    expect(pad && Number(pad[1]) * 2).toBeLessThanOrEqual(16)
  })

  it('沒在搜尋時，說明文字只留給螢幕閱讀器（視覺隱藏），搜尋時才顯示「符合 n 項」', () => {
    const hidden = rule(".fr[data-searching='false'] .fr-search-status")
    expect(hidden).toMatch(/position:\s*absolute/)
    expect(hidden).toMatch(/clip-path:\s*inset\(50%\)/)
  })

  it('視窗 901–1200px（側欄還在、內容欄只有 550–850px）：收掉「搜尋」標籤、目錄鈕縮 padding；901–1100px 再藏序號，搜尋列才排得進一列', () => {
    const block = (head: string) => {
      const i = noComments.indexOf(head)
      expect(i, head).toBeGreaterThan(-1)
      return noComments.slice(i, noComments.indexOf('\n}\n', i))
    }
    const mid = block('@media (min-width: 901px) and (max-width: 1200px) {')
    expect(mid).toMatch(/\.fr-search-label \{\s*display:\s*none/)
    expect(mid).toMatch(/\.fr-toc-btn \{\s*padding:\s*1px 6px/)
    expect(block('@media (min-width: 901px) and (max-width: 1100px) {')).toMatch(/\.fr-toc-num \{\s*display:\s*none/)
  })

  it('瀏覽器自己的「×」與「清除」鈕重複：隱藏它', () => {
    expect(rule('.fr .fr-search-input::-webkit-search-cancel-button')).toMatch(/display:\s*none/)
  })
})

describe('寬表格的提示與統一的表格樣式', () => {
  it('.fr-fade：兩側漸層預設不顯示（opacity: 0），data-fade-start / data-fade-end = 1 時才顯示', () => {
    expect(rule('.fr-fade::before,\n.fr-fade::after')).toMatch(/opacity:\s*0/)
    expect(css).toMatch(/\.fr-fade\[data-fade-start='1'\]::before,\s*\.fr-fade\[data-fade-end='1'\]::after \{\s*opacity:\s*0\.\d+/)
    expect(rule('.fr-fade::before,\n.fr-fade::after')).toMatch(/pointer-events:\s*none/)
  })

  it('手機（≤ 640px）的卡片排版不畫漸層：卡片是直向排版，沒有欄可以往右捲', () => {
    expect(noComments).toMatch(/@media \(max-width: 640px\) \{\s*\.fr-fade::before,\s*\.fr-fade::after \{\s*display:\s*none;/)
  })

  it('本頁的 .fr-table 不再自己縮小字級（沿用全站 table 的 0.94rem、6px 8px 內距）', () => {
    const t = rule('.fr-table')
    expect(t).not.toMatch(/font-size/)
    expect(t).not.toMatch(/padding/)
    expect(noComments).not.toMatch(/^\.fr-table\s+t[dh]\s*\{[^}]*padding/m)
  })
})
