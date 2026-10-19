import { Section, Tex } from '@/components'
import { Intro } from './sections/Intro'
import { Polarity } from './sections/Polarity'
import { FirstOrderPm } from './sections/FirstOrderPm'
import { UpdateDelay } from './sections/UpdateDelay'
import { DualLoop } from './sections/DualLoop'
import { Wrapup } from './sections/Wrapup'
import { ChapterSymbols, SYMBOLS_LINK_ID } from './sections/Symbols'
import { PmLab } from './experiments/PmLab'
import { DualLoopLab } from './experiments/DualLoopLab'
import './chapter.css'

/**
 * Ch08「Calibration Phase Margin 與雙迴路耦合」（規格 §8；入門課 Lesson 8–9；T08、T09；勘誤 E19、E20、E31）。
 * 所有數值與曲線都由 src/simulation/models/stability.ts（與 blockLms 的 Monte Carlo）即時計算。
 */
export default function Chapter08() {
  // 根元素帶 id／tabIndex：章末符號表的「↑ 回到章首」捲到這裡（原本的目標是章首那一行 SymbolsLink，已由 PageFrame 的本章資訊 strip 取代）
  return (
    <div className="ch08" id={SYMBOLS_LINK_ID} tabIndex={-1}>
      <Intro />
      <Polarity />
      <FirstOrderPm />
      <UpdateDelay />
      <Section kind="explore" title="互動實驗 1：Phase Margin Lab" level={2} id="ch08-pm-lab">
        <p>
          把 §8.2–8.3 的所有圖放在一起：調 <Tex>{'g'}</Tex> 與 <Tex>{'d'}</Tex>，同時看 Bode、Nyquist、z 平面、step response 與 <Tex>{'d=0\\ldots6'}</Tex> 的界限表。按「執行 Run」會在 Web
          Worker 裡跑真實的 block sign-LMS（含 comparator 雜訊），和線性模型逐 block 比對。
        </p>
        <PmLab />
      </Section>
      <DualLoop />
      <Section kind="explore" title="互動實驗 2：Dual-Loop Explorer" level={2} id="ch08-dual-lab">
        <p>
          同一組 <Tex>{'r_s,b_s,c_s,\\mu'}</Tex>，並排比較完整模型與 quasi-static 簡化模型；切到「一般化 state-space」可以輸入任意 1–3 維的觀測動態，檢查{' '}
          <Tex>{'\\rho(\\mathbf A_{\\mathrm{comb}})'}</Tex> 與 <Tex>{'L_{\\mathrm{cal}}=\\mu F(z)/(z-1)'}</Tex> 的 PM。
        </p>
        <DualLoopLab />
      </Section>
      <Wrapup />
      {/* 本章符號表放在最後（teaching-style §5）；章首的「符號表 ↓」與章末交棒由 PageFrame 的章首／章末骨架提供（§9） */}
      <ChapterSymbols />
    </div>
  )
}
