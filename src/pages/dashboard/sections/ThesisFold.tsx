import type { ReactNode } from 'react'
import { FoldCard } from './FoldCard'

// 哪些 id 收在這張卡片裡（FOLD_IDS）定義在 foldIds.ts，這裡再匯出一份（index.research.test.tsx 從這裡讀）
export { FOLD_IDS } from './foldIds'

/**
 * Beginner 模式：把「六個條件／一條方程式／動手體檢」整段收成一張卡片，按一下就地展開。
 * 內容（約 1,000 條公式、三張方塊圖、一個互動實驗）只在展開後才渲染，新手首頁才不會一開始就是研究級儀表板；
 * 體檢的參數（Case A/B/C）放在上層的 useCases，收合再展開不會遺失。Engineer / Research 模式不經過這裡。
 * 這一段展開後有一萬多 px：最後放一顆「收合」，收起來並捲回卡片本身，讀者不必捲回頂端找 summary。
 */
export function ThesisFold({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <FoldCard
      id="dash-fold"
      className="dash-fold"
      title="給讀完 Part B 的人：六條件一分鐘體檢"
      desc="六個條件的檢查表、用一條方程式推出它們的四段推導與帶入手算，以及可以調參數看燈號的動手體檢。這一段用到期望值與特徵值，建議讀完 Part B 再回來；Engineer 模式會直接展開。"
      open={open}
      onOpenChange={onOpenChange}
      collapseLabel="收合「六條件一分鐘體檢」，回到卡片 ↑"
    >
      {children}
    </FoldCard>
  )
}
