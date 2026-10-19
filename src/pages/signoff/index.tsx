import { S0Intro } from './sections/S0Intro'
import { ReviewMatrix } from './sections/S1Matrix'
import { S2Polarity } from './sections/S2Polarity'
import { S3Claims } from './sections/S3Claims'
import { S4Cases } from './sections/S4Cases'
import { S4bPvt } from './sections/S4bPvt'
import { S8Silicon } from './sections/S8Silicon'
import { S5Negative } from './sections/S5Negative'
import { S6Limits } from './sections/S6Limits'
import { S7Wrap } from './sections/S7Wrap'
import { PAGE_TOP_ANCHOR, SymbolsJump, SymbolsSection } from './sections/S12Symbols'
import { RichText, TOC, scrollToAnchor } from './shared'
import './signoff.css'

/**
 * Sign-off Checklist / Design Review（規格 §16.2 Sign-off Matrix、§16.3「何時可以宣稱穩定」、§17 反面測試、附錄 B）。
 * 互動 matrix 的狀態存在讀者自己的瀏覽器（usePersistentState，key 'lmspll.signoff.*'），可匯出 Markdown／JSON。
 * 所有數字由 ./judges.ts 即時計算；勘誤以 docs/validation.md 為準（「勘誤 Exx」連到 #/verification）。
 * 方塊圖（docs/teaching-style.md §8）：九張，定義在 ./diagrams.ts（sign-off 六道關卡、freeze ±Δ 量測、證據強度、Corner 判準、PVT 三種效應、多參數迴路、輸出路徑、矽上量測迴圈、反面測試）。
 * 符號表在頁末（id="symbols"，sections/S12Symbols.tsx）；頁首只留一行「本頁符號表在最後 ↓」（docs/teaching-style.md §5）。
 */
export default function SignoffPage() {
  return (
    <div className="so-page" id={PAGE_TOP_ANCHOR}>
      <nav className="so-toc" aria-label="本頁目錄">
        {TOC.map((t) => (
          <a
            key={t.id}
            href="#/signoff"
            onClick={(e) => {
              e.preventDefault()
              scrollToAnchor(t.id)
            }}
          >
            <RichText text={t.label} />
          </a>
        ))}
      </nav>
      <SymbolsJump />
      <S0Intro />
      <ReviewMatrix />
      <S2Polarity />
      <S3Claims />
      <S4Cases afterCorner={<S4bPvt />} />
      <S8Silicon />
      <S5Negative />
      <S6Limits />
      <S7Wrap />
      <SymbolsSection />
    </div>
  )
}
