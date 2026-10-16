import { MODE_LABEL, MODES, useSettings, type LearningMode } from '@/app/settings'

/**
 * 第一次造訪（localStorage 還沒有 lmspll.mode）時在每頁頂端顯示一次的三卡片選擇器。
 * 文字沿用 Dashboard「三種學習模式」段落（src/pages/dashboard/sections/Modes.tsx）的 MODES 資料，各濃縮成一句；
 * 不 import dashboard 的程式碼，避免共用元件依賴頁面。
 */
export const MODE_BLURB: Record<LearningMode, string> = {
  beginner: '只有微積分基礎、想一步一步弄懂：先問題、再手算、再公式；推導預設收合，一鍵展開。',
  engineer: 'PLL / SerDes / mixed-signal 設計者：推導、假設、單位、極性預設展開，完整參數面板。',
  research: '架構師、需要做 sign-off 或延伸研究：額外的嚴格條件、反例、Monte Carlo 細節與相關文獻。',
}

export const MODE_PICKER_DISMISS = '先用 Beginner 看看'

export function ModePicker() {
  const { modeChosen, setMode } = useSettings()
  if (modeChosen) return null
  return (
    <section className="c-modepicker" aria-labelledby="c-modepicker-h" data-testid="mode-picker">
      <h2 id="c-modepicker-h">先選一個學習模式</h2>
      <p>三種模式共用同一個計算核心，只改變預設展開哪些推導與參數；右上角隨時可換，選擇只存在你的瀏覽器。</p>
      <div className="c-modepicker-cards">
        {MODES.map((m) => (
          <button key={m} type="button" className="c-modepicker-card" onClick={() => setMode(m)} data-mode={m}>
            <strong>{MODE_LABEL[m]}</strong>
            <span>{MODE_BLURB[m]}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn c-modepicker-dismiss" onClick={() => setMode('beginner')}>
        {MODE_PICKER_DISMISS}
      </button>
    </section>
  )
}
