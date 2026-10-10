import { S0Intro } from './sections/S0Intro'
import { ReviewMatrix } from './sections/S1Matrix'
import { S2Polarity } from './sections/S2Polarity'
import { S3Claims } from './sections/S3Claims'
import { S4Cases } from './sections/S4Cases'
import { S5Negative } from './sections/S5Negative'
import { S6Limits } from './sections/S6Limits'
import { S7Wrap } from './sections/S7Wrap'
import type { MouseEvent } from 'react'
import { RichText, TOC, scrollToAnchor } from './shared'
import './signoff.css'

/**
 * 頁內公式錨點：網站用 HashRouter，`#formula-F-SO.4` 這種 hash 會被當成路由而顯示「找不到此頁面」。
 * 共用的 MetricTable「公式」欄會產生 `<a href="#formula-…">`，這裡在頁面根節點攔截，改成捲動到該公式
 * （公式若在 Beginner 模式收合的 <details> 內，先展開）。
 */
function onFormulaAnchorClick(e: MouseEvent<HTMLDivElement>) {
  const a = (e.target as HTMLElement | null)?.closest?.('a[href^="#formula-"]')
  if (!a) return
  e.preventDefault()
  const id = decodeURIComponent((a.getAttribute('href') ?? '').slice(1))
  const el = document.getElementById(id)
  if (!el) return
  for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true
  scrollToAnchor(id)
}

/**
 * Sign-off Checklist / Design Review（規格 §16.2 Sign-off Matrix、§16.3「何時可以宣稱穩定」、§17 反面測試、附錄 B）。
 * 互動 matrix 的狀態存在讀者自己的瀏覽器（usePersistentState，key 'lmspll.signoff.*'），可匯出 Markdown／JSON。
 * 所有數字由 ./judges.ts 即時計算；勘誤以 docs/validation.md 為準（「勘誤 Exx」連到 #/verification）。
 */
export default function SignoffPage() {
  return (
    <div className="so-page" onClick={onFormulaAnchorClick}>
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
      <S0Intro />
      <ReviewMatrix />
      <S2Polarity />
      <S3Claims />
      <S4Cases />
      <S5Negative />
      <S6Limits />
      <S7Wrap />
    </div>
  )
}
