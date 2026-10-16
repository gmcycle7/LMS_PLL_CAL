import { useCallback, type ReactNode, type SyntheticEvent } from 'react'

/**
 * 收在卡片裡的元素 id（Hero 的膠囊／目錄、系統地圖的「一條方程式」按鈕、條件卡片的「載入反例」、網址的 ?a=／?f= 深連結都可能指到這裡面）：
 * 三個段落與它們的標題、六張條件卡片、四段推導的公式 F-DB.n 與帶入手算 HC-DB.1–5（HC-DB.6 在「本頁必記」，卡片外）、
 * 體檢實驗本身（exp-dashboard-thesis-check）與 Monte Carlo 交叉比對。index.research.test.tsx 檢查這條規則恰好涵蓋卡片裡的 id。
 */
export const FOLD_IDS = /^(dash-thesis|dash-spine|dash-check|dash-cond-|dash-mc|formula-F-DB\.|handcalc-HC-DB\.[1-5]$|exp-dashboard-thesis-check)/

/**
 * Beginner 模式：把「六個條件／一條方程式／動手體檢」整段收成一張卡片，按一下就地展開。
 * 內容（約 1,000 條公式、三張方塊圖、一個互動實驗）只在展開後才渲染，新手首頁才不會一開始就是研究級儀表板；
 * 體檢的參數（Case A/B/C）放在上層的 useCases，收合再展開不會遺失。Engineer / Research 模式不經過這裡。
 */
export function ThesisFold({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const onToggle = useCallback((e: SyntheticEvent<HTMLDetailsElement>) => onOpenChange(e.currentTarget.open), [onOpenChange])
  // 這一段展開後有一萬多 px：最後放一顆「收合」，收起來並捲回卡片本身，讀者不必捲回頂端找 summary
  const collapse = useCallback(() => {
    onOpenChange(false)
    document.getElementById('dash-fold')?.scrollIntoView?.({ behavior: 'auto', block: 'start' })
  }, [onOpenChange])
  return (
    <details id="dash-fold" className="dash-fold" open={open} onToggle={onToggle}>
      <summary className="dash-fold-summary">
        <span className="dash-fold-title">
          給讀完 Part B 的人：六條件一分鐘體檢<span className="dash-fold-state">（{open ? '收合' : '展開'}）</span>
        </span>
        <span className="dash-fold-desc">
          六個條件的檢查表、用一條方程式推出它們的四段推導與帶入手算，以及可以調參數看燈號的動手體檢。這一段用到期望值與特徵值，建議讀完 Part
          B 再回來；Engineer 模式會直接展開。
        </span>
      </summary>
      {open && (
        <div className="dash-fold-body">
          {children}
          <div className="dash-fold-end">
            <button type="button" className="btn" onClick={collapse}>
              收合「六條件一分鐘體檢」，回到卡片 ↑
            </button>
          </div>
        </div>
      )}
    </details>
  )
}
