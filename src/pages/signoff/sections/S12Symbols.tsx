import { Link } from 'react-router-dom'
import { SymbolTable, mathText, revealAnchor } from '@/components'
import { SYMBOL_CAPTION, SYMBOL_ROWS } from '../symbols'

/** 頁末符號表的錨點（docs/teaching-style.md §5：符號表放最後，外層 id="symbols"）。 */
export const SYMBOLS_ANCHOR = 'symbols'
/** 頁首的錨點（符號表旁的「回到頁首」用）。 */
export const PAGE_TOP_ANCHOR = 'so-top'

/** 頁首只留這一行：按了捲到頁末的符號表。HashRouter 下 href="#symbols" 會被當成路由，所以用按鈕 + scrollIntoView。 */
export function SymbolsJump() {
  return (
    <p className="so-symbols-jump">
      <button type="button" className="so-linkbtn" onClick={() => revealAnchor(SYMBOLS_ANCHOR)}>
        本頁符號表在最後 ↓
      </button>
      <span className="so-symbols-jump-note">每個符號第一次出現時，正文會先用一句話說明。</span>
    </p>
  )
}

/** 頁末的符號表：排在「本頁必記」之後，是整頁最後一個區塊。 */
export function SymbolsSection() {
  return (
    <section id={SYMBOLS_ANCHOR} className="so-symbols" aria-labelledby="so-symbols-title">
      <h2 id="so-symbols-title">本頁符號表</h2>
      <p className="small">
        整頁用到的符號集中列在這裡，忘記某個符號時回來查：單位、第一次出現的小節，以及有勘誤或同一個字母有兩種用法時本頁採用的定義。全站的符號總表在{' '}
        <Link to="/formulas">Formula &amp; Unit Reference</Link>。{' '}
        <button type="button" className="so-linkbtn" onClick={() => revealAnchor(PAGE_TOP_ANCHOR)}>
          ↑ 回到頁首
        </button>
      </p>
      <SymbolTable rows={SYMBOL_ROWS} title="本頁符號" caption={mathText(SYMBOL_CAPTION)} />
    </section>
  )
}
