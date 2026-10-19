import { revealAnchor, SymbolTable } from '@/components'
import { ChLink, md } from '../common'
import { MODEL_SYMBOLS } from '../symbols'

/** 頁末符號表的錨點（docs/teaching-style.md §5：符號表放最後，外層 id="symbols"）。 */
export const SYMBOLS_ANCHOR = 'symbols'
/** 頁首的錨點（符號表旁的「回到頁首」用）。 */
export const PAGE_TOP_ANCHOR = 'models-top'

/** 頁首只留這一行：按了捲到頁末的符號表。 */
export function SymbolsJump() {
  return (
    <p className="models-symbols-jump">
      <button type="button" className="models-linkbtn" onClick={() => revealAnchor(SYMBOLS_ANCHOR)}>
        本頁符號表在最後 ↓
      </button>
      <span className="models-symbols-jump-note">每個符號第一次出現時，正文會先用一句話說明。</span>
    </p>
  )
}

/** 頁末的符號表：排在「本頁必記」之後，是整頁最後一個區塊。 */
export function SymbolsSection() {
  return (
    <section id={SYMBOLS_ANCHOR} className="models-symbols" aria-labelledby="models-symbols-title">
      <h2 id="models-symbols-title">本頁符號表</h2>
      <p className="small">
        整頁用到的符號集中列在這裡，忘記某個符號時回來查：單位、第一次出現的小節，以及它對應 §15.3 JSON 的哪一個欄位。全站的符號總表在{' '}
        <ChLink to="/formulas">Formula &amp; Unit Reference</ChLink>。{' '}
        <button type="button" className="models-linkbtn" onClick={() => revealAnchor(PAGE_TOP_ANCHOR)}>
          ↑ 回到頁首
        </button>
      </p>
      <SymbolTable rows={MODEL_SYMBOLS} title="本頁符號" caption={md('時間索引：$n$ = comparator sample、$k$ = GMAC block（附錄 B）。單位：時間一律 fs；code 正規化後無因次。')} />
    </section>
  )
}
