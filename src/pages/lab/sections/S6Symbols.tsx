import { SymbolTable, jumpToId } from '@/components'
import { ChLink, md } from '../common'
import { LAB_SYMBOLS } from '../symbols'

/** 頁末符號表的錨點（docs/teaching-style.md §5：符號表放最後，外層 id="symbols"）。 */
export const SYMBOLS_ANCHOR = 'symbols'
/** 頁首的錨點（符號表旁的「回到頁首」用）。 */
export const PAGE_TOP_ANCHOR = 'lab-top'

/** 頁首只留這一行：按了捲到頁末的符號表。 */
export function SymbolsJump() {
  return (
    <p className="lab-symbols-jump">
      <button type="button" className="lab-linkbtn" onClick={() => jumpToId(SYMBOLS_ANCHOR)}>
        本頁符號表在最後 ↓
      </button>
      <span className="lab-symbols-jump-note">每個符號第一次出現時，正文會先用一句話說明。</span>
    </p>
  )
}

/** 頁末的符號表：排在「本頁必記」之後，是整頁最後一個區塊。 */
export function SymbolsSection() {
  return (
    <section id={SYMBOLS_ANCHOR} className="lab-symbols" aria-labelledby="lab-symbols-title">
      <h2 id="lab-symbols-title">本頁符號表</h2>
      <p className="small">
        整頁用到的符號集中列在這裡，忘記某個符號時回來查：單位、第一次出現的小節，以及和其他章節用同一個字母時本頁採用的定義。全站的符號總表在{' '}
        <ChLink to="/formulas">Formula &amp; Unit Reference</ChLink>。{' '}
        <button type="button" className="lab-linkbtn" onClick={() => jumpToId(PAGE_TOP_ANCHOR)}>
          ↑ 回到頁首
        </button>
      </p>
      <SymbolTable
        rows={LAB_SYMBOLS}
        title="本頁符號（依第一次出現的小節排列）"
        caption={md('頻率變數：$z=e^{j\\Omega}$，$\\Omega=2\\pi f/f_s$（rad/sample）。所有時間量以 fs 計；$a$、$w$、$\\mu$ 的單位帶 fs 是因為 code 已正規化成無因次。時間索引：$n$ 是 comparator sample、$k$ 是 GMAC block。')}
      />
    </section>
  )
}
