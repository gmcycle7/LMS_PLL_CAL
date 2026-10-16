import { Callout, ClaimTag, ModelLevel, SourceTag, Tex, ChRef } from '@/components'
import { Erratum } from './common'
import { IntroSection } from './sections/Intro'
import { ParabolaSection } from './sections/Parabola'
import { HandExampleSection } from './sections/HandExample'
import { LossesSection } from './sections/Losses'
import { MedianExampleSection } from './sections/MedianExample'
import { WrapupSection } from './sections/Wrapup'
import { SymbolsJump, SymbolsSection } from './symbols'
import './chapter.css'

/**
 * Ch01「LMS 為什麼叫 Least Mean Squares？」（規格 §1、§2；驗證 T01 / T02）。
 * 章節結構：（一行）符號表在最後 → §1.0 問題＋系統地圖 → §1.1 拆字 → §1.2 拋物線與 w* → §1.3 ½ 與 SGD → §1.4 手算 → §1.5 Playground
 *          → §2.1 三種損失 → §2.2 次梯度與 sign(0) → §2.3 平均 vs 中位數 → §2.3.1 逐筆更新的穩態（格點鏈，E40）
 *          → §2.3.2 連續雜訊下 Sign-Error 的抖動（F-01.18）→ §2.4（Research）污染資料 → §2.5 MSE vs MAE Lab → §2.6 比較與 PLL → 思考題 → 必記
 *          → 符號表（章末，id="symbols"；docs/teaching-style.md §5）。
 * 方塊圖（docs/teaching-style.md §8）：章首 <SystemMap> ＋ diagrams.ts 的 22 張圖，各放在白話說明之後、推導之前。
 * 計算核心：src/simulation/models/lms.ts（步進器，唯讀共用）與 lossCompare.ts（本章）。
 */
export default function Chapter01() {
  return (
    <div className="ch01-chapter">
      <div className="c-tag-row">
        <ModelLevel level="L0" />
        <ClaimTag kind="exact" />
        <SourceTag />
      </div>
      <SymbolsJump />
      <Callout kind="info" title="本章套用的勘誤">
        <p className="small">
          <Erratum id="E39" /> 剩餘參數誤差採 <Tex>{String.raw`\delta=a-w`}</Tex>（真值 <Tex>{'a'}</Tex> 減去目前的猜測 <Tex>{'w'}</Tex>，不是{' '}
          <Tex>{'w-a'}</Tex>）、<Erratum id="E40" /> <Tex>{String.raw`\operatorname{sign}(0)`}</Tex>（誤差剛好是 0 時的「正負號」）慣例明定、
          <Erratum id="E41" /> 成本含 <Tex>{String.raw`\tfrac12`}</Tex>：<Tex>{String.raw`J=\tfrac12J_2`}</Tex>（<Tex>{'J_2'}</Tex> 是規格裡沒有{' '}
          <Tex>{String.raw`\tfrac12`}</Tex> 的平方誤差平均）、<Erratum id="E43" /> Sign-Sign 列拼字、<Erratum id="E38" /> 輸入 <Tex>{'x'}</Tex> 是 iid 純量時
          mean / mean-square 遞迴是精確式（詳見 <ChRef ch="03">Ch03</ChRef>）。這些符號在正文第一次出現時都會再說明一次；點擊標籤前往驗證頁的勘誤清單。
        </p>
      </Callout>
      <IntroSection />
      <ParabolaSection />
      <HandExampleSection />
      <LossesSection />
      <MedianExampleSection />
      <WrapupSection />
      <SymbolsSection />
    </div>
  )
}
