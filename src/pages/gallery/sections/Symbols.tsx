import { SymbolTable, Tex } from '@/components'
import { ErratumChip } from '../common'
import { CHECK_SYMBOLS, MODEL_SYMBOLS } from '../symbols'
import { JumpButton } from './SlotAudit'

/** 頁尾符號表外層的 DOM id（docs/teaching-style.md §5：符號表放在最後，頁首只留一行連結） */
export const SYMBOLS_ANCHOR = 'symbols'

/**
 * 頁首的一行連結。HashRouter 下 href="#symbols" 會被當成路由，所以用按鈕 + scrollIntoView（JumpButton）。
 */
export function SymbolsLink() {
  return (
    <p className="gal-symbols-link">
      <JumpButton domId={SYMBOLS_ANCHOR}>本頁符號表在最後 ↓</JumpButton>
      <span className="small muted">每個符號第一次出現時，正文會先用一句話說明；頁尾的表是查閱用的總整理。</span>
    </p>
  )
}

/**
 * 頁尾的符號表：整頁最後一個區塊（§10 的思考題、必記與「連結到 PLL」之後）。
 * 分兩張：(1) 比對預期文字用的符號（本頁新增）；(2) 12 個例子共用的符號（定義與各章相同）。
 */
export function SymbolsSection() {
  return (
    <section id={SYMBOLS_ANCHOR} className="gal-section gal-symbols" aria-labelledby="gallery-symbols-title">
      <h2 id="gallery-symbols-title">本頁符號表</h2>
      <p className="small muted">
        正文裡每個符號第一次出現時都已經就地說明；這裡把它們集中起來，方便回頭查單位、第一次出現的段落，以及和全站約定或勘誤的關係。 <JumpButton domId="gal-s1">↑ 回到頁首</JumpButton>
      </p>
      <SymbolTable title="(1) 比對預期文字用的符號（本頁新增）" rows={CHECK_SYMBOLS} />
      <SymbolTable
        title="(2) 12 個例子共用的符號（定義與各章相同）"
        rows={MODEL_SYMBOLS}
        caption={
          <>
            極性與單位依全站約定（規格 §0）與 <code>docs/validation.md</code> 的勘誤：<Tex>{'\\delta=a-w'}</Tex> <ErratumChip eid="E39" />、<Tex>{'K=K_qC'}</Tex> 與 <Tex>{'g=\\mu K'}</Tex>{' '}
            <ErratumChip eid="E13" />。時間誤差一律用 fs、相位用 rad；時間索引 <Tex>{'n'}</Tex> 是 comparator sample、<Tex>{'k'}</Tex> 是 GMAC block。
          </>
        }
      />
    </section>
  )
}
