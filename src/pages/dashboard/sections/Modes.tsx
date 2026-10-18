import { memo } from 'react'
import { MODE_LABEL, useSettings, type LearningMode } from '@/app/settings'

interface ModeDef {
  id: LearningMode
  who: string
  shows: string[]
}

/** 規格 §18.2 + docs/teaching-style.md §6 */
const MODES: ModeDef[] = [
  {
    id: 'beginner',
    who: '只有微積分基礎、想一步一步弄懂的人',
    shows: ['先問題、再手算、再公式：每個例子先用數字算一次', '推導預設收合，一鍵展開；先備知識框補期望值、特徵值等', '互動圖只露出最關鍵的參數', '每課最後有思考題與「本課必記」'],
  },
  {
    id: 'engineer',
    who: 'PLL / SerDes / mixed-signal 設計者',
    shows: ['推導、假設、單位、極性預設展開', '完整參數面板：每個滑桿標示合法範圍與對應的 register', '方塊圖、Bode / PSD、eigen-mode 表與核心程式碼比較', '每個結論標示精確 / 近似 / 研究假說'],
  },
  {
    id: 'research',
    who: '架構師、需要做 sign-off 或延伸研究的人',
    shows: ['額外的嚴格條件、反例與邊界情況（例如 commit 延遲、雙參數推導）', 'Monte Carlo 細節、信賴區間與 Analytic / MC / Fixed-Point 交叉比對', '15 個問題的短答案預設展開', '相關文獻與 Research Backlog'],
  },
]

/** 三種學習模式：同一個計算核心，只改變呈現（不可對同一組參數算出三種答案） */
export const ModesSection = memo(function ModesSection() {
  const { mode, setMode } = useSettings()
  return (
    <section id="dash-modes" aria-labelledby="dash-modes-h">
      <h2 id="dash-modes-h" className="dash-h2">
        三種學習模式 <span className="dash-h2-kicker">規格 §18.2</span>
      </h2>
      <p className="dash-lead-sm">
        右上角可以隨時切換。三種模式<strong>共用同一個計算核心</strong>：切換只改變預設展開哪些推導、顯示哪些參數與指標，同一組參數永遠得到同一個答案。你的選擇只存在自己的瀏覽器。
      </p>
      <div className="dash-modes">
        {MODES.map((m) => {
          const active = m.id === mode
          return (
            <article key={m.id} className={`dash-mode${active ? ' is-active' : ''}`} aria-current={active ? 'true' : undefined}>
              <h3>{MODE_LABEL[m.id]}</h3>
              <div className="small muted">適合：{m.who}</div>
              <ul>
                {m.shows.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <button type="button" className={`btn${active ? '' : ' btn-primary'}`} onClick={() => setMode(m.id)} disabled={active}>
                {active ? '目前模式' : `切換到 ${MODE_LABEL[m.id]}`}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
})
