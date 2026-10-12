import { Callout, ClaimTag, ModelLevel, Section, SourceTag, SystemMap, TestBadge, Tex } from '@/components'
import { MODE_LABEL, useSettings } from '@/app/settings'
import { BlackBoxSection, LoopSection, UpdateFormulaSection } from './sections/BlackBox'
import { HAND_CALC_PARAMS, HandCalcSection } from './sections/HandCalc'
import { WhyExSection } from './sections/WhyEx'
import { NoiseAverageSection } from './sections/NoiseAverage'
import { WhyMattersSection } from './sections/WhyMatters'
import { SignTeaserSection } from './sections/SignTeaser'
import { AssumptionsSection } from './sections/Assumptions'
import { LearningMapSection, QuizSection, RecapSection } from './sections/Wrapup'
import { CHAPTER_TOP_ANCHOR, SymbolsJump, SymbolsSection } from './sections/Symbols'
import { IntroPlayground } from './experiments/IntroPlayground'
import { DEFAULT_BASE, DEFAULT_MUS } from './experiments/playgroundModel'
import { fixedXMuMax, fixedXPole } from '@/simulation/models/lms'
import { texNum } from './format'
import { ChapterDiagram, FigRef } from './common'
import { SYSTEM_MAP_FOCUS } from './diagrams'
import './chapter.css'

/** 章首「方塊圖怎麼讀」的圖例：classDef 的四個顏色（與 diagrams.ts 的 CLASS_DEFS 相同）。 */
const LEGEND_COLOURS = [
  { colour: '#1f5fa8', meaning: '藍：這張圖的主角' },
  { colour: '#b42318', meaning: '紅：雜訊，或會出問題的地方' },
  { colour: '#1d7a46', meaning: '綠：結果' },
  { colour: '#3d4450', meaning: '深灰：打不開的黑盒子' },
]

export default function Chapter00() {
  const { mode } = useSettings()
  const muMax = fixedXMuMax(DEFAULT_BASE.x)
  return (
    <div className="ch00" id={CHAPTER_TOP_ANCHOR}>
      <div className="ch00-question">
        <strong>這一課要回答的問題：</strong>你只能觀察一個黑盒子的輸入 <Tex>{'x'}</Tex> 和輸出 <Tex>{'y'}</Tex>，不知道裡面的係數{' '}
        <Tex>{'a'}</Tex>。資料還有雜訊。要怎麼<strong>一筆一筆地</strong>把 <Tex>{'a'}</Tex> 學出來？——答案就是 LMS。
      </div>

      <SystemMap focus={SYSTEM_MAP_FOCUS} />
      <p className="ch00-map-note">
        <strong>你在這裡：</strong>藍色的六個方塊就是 LMS 校正迴路本身——拿來相乘的 code <Tex>{'x[n]'}</Tex>（regressor）、乘上目前猜測 <Tex>{'w'}</Tex> 的 gain
        correction（它的輸出去控制 reference 端的 DTC）、輸入取自 PD 輸出 <Tex>{'e[n]'}</Tex> 的 1-bit comparator、把很多筆乘積加起來的 GMAC、「除以 <Tex>{'N'}</Tex>、乘上 <Tex>{'\\mu'}</Tex>」，以及存放 <Tex>{'w'}</Tex> 的 gain accumulator。
        這一章先把圖上其餘的部分（PLL 主迴路、DTC、phase detector）縮成一個「黑盒子」<Tex>{'y=ax+v'}</Tex>，只學這條藍色迴路最簡單的版本：
        <strong>預測 → 比較 → 修正</strong>。每個藍色方塊對應到哪一個動作，§0.8 會一格一格對回來。
      </p>
      <SymbolsJump />

      <div className="ch00-tags">
        <ModelLevel level="L0" />
        <ClaimTag kind="exact" />
        <SourceTag kind="illustrative" />
        <TestBadge id="T01" />
        <TestBadge id="T02" />
      </div>
      <p className="ch00-lead">
        這是整個網站的第一課，只假設你會微積分（導數、chain rule、等比數列）。我們會先用數字手算，再推導公式，最後動手玩互動實驗。
        學完你會知道：
      </p>
      <ol className="ch00-goals">
        <li>LMS 的三個動作（預測 → 比較 → 修正）與更新公式 <Tex>{'w_{n+1}=w_n+\\mu e_nx_n'}</Tex>。</li>
        <li>為什麼更新量是 <Tex>{'e\\cdot x'}</Tex>（一次微分就能證明）。</li>
        <li>
          學習率 <Tex>{'\\mu'}</Tex> 太小、剛好、太大會發生什麼，以及 <Tex>{'0<\\mu<2/x^2'}</Tex> 從哪來。
        </li>
        <li>為什麼有雜訊還學得會（期望值與 <Tex>{'1/\\sqrt N'}</Tex>）。</li>
        <li>LMS 和 PLL / DTC 校正、SerDes 等化器、降噪耳機、AI 訓練的關係。</li>
      </ol>
      <Callout kind="info" title={null}>
        目前學習模式：<strong>{MODE_LABEL[mode]}</strong>。Beginner 只看直覺、手算與圖（推導預設收合，一鍵展開）；Engineer 預設展開推導並顯示更多程式碼與指標；
        Research 另外顯示精確有理數驗算、隨機輸入的三種穩定界限等細節。三種模式用的是同一份計算程式。
      </Callout>
      <Callout kind="info" title="本章的方塊圖怎麼讀">
        每個主要概念都先畫一張方塊圖、再寫公式；每張圖下面有一段「怎麼看圖」，告訴你先看哪裡、圖上的哪個訊號就是公式裡的哪個符號。圖上的寫法只有四條規則：
        <ul className="ch00-legend">
          <li>
            <strong>方括號是時間索引</strong>：圖上的 <Tex>{'x[n]'}</Tex> 就是公式裡的 <Tex>{'x_n'}</Tex>（第 <Tex>{'n'}</Tex> 筆資料）；<Tex>{'w[n+1]'}</Tex> 就是{' '}
            <Tex>{'w_{n+1}'}</Tex>。§0.8 之後出現的 <Tex>{'w[k]'}</Tex> 是 <Tex>{'w_k'}</Tex>（第 <Tex>{'k'}</Tex> 個 block，一個 block 有 <Tex>{'N'}</Tex> 筆）。
          </li>
          <li>
            <strong>圓圈是運算</strong>：圓圈 <Tex>{'+'}</Tex> 是相加點，進入它的線以 <Tex>{'(+)'}</Tex> 或 <Tex>{'(-)'}</Tex> 開頭，表示這條訊號是被加還是被減；圓圈 <Tex>{'\\times'}</Tex> 是乘法器；寫著「
            <Tex>{'\\times\\,\\mu'}</Tex>」的方塊是乘上一個常數（增益）。
          </li>
          <li>
            <strong>
              <Tex>{'z^{-1}'}</Tex> 是暫存器
            </strong>
            ：它的輸出是「上一拍寫進去的值」，也就是延遲一筆資料（Z transform 到 Ch03 才正式介紹，這裡把它當成一個暫存器就好）。
          </li>
          <li>
            <strong>顏色</strong>：
            {LEGEND_COLOURS.map((c, i) => (
              <span key={c.colour}>
                <span className="ch00-swatch" style={{ background: c.colour }} aria-hidden="true" />
                {c.meaning}
                {i < LEGEND_COLOURS.length - 1 ? '；' : '。'}
              </span>
            ))}
          </li>
        </ul>
      </Callout>
      <BlackBoxSection />
      <LoopSection />
      <UpdateFormulaSection />
      <HandCalcSection />

      <Section
        kind="explore"
        level={2}
        id="ch00-playground"
        title={
          <>
            §0.5 動手玩：<Tex>{'\\mu'}</Tex> 太小、剛好、太大
          </>
        }
      >
        <p>
          手算表只示範了 <Tex>{`\\mu=${texNum(HAND_CALC_PARAMS.mu)}`}</Tex>。下面三組比較（Case A / B / C）預設為{' '}
          <Tex>{`\\mu=${texNum(DEFAULT_MUS[0])}`}</Tex>（慢）、<Tex>{texNum(DEFAULT_MUS[1])}</Tex>（穩）、<Tex>{texNum(DEFAULT_MUS[2])}</Tex>（發散），
          <Tex>{`x=${texNum(DEFAULT_BASE.x)}`}</Tex> 時理論穩定區是 <Tex>{`0<\\mu<2/x^2=${texNum(muMax)}`}</Tex>（§0.6 推導）。
          每個滑桿旁都能輸入精確數字，也可以從「Preset」選單載入其他情境（一步到位、邊界、雜訊、極性錯誤）；「雜訊」那一組會打開量測雜訊{' '}
          <Tex>{'v'}</Tex>，它的標準差（RMS，抖動的典型大小）記為 <Tex>{'\\sigma_v'}</Tex>。
        </p>
        <p>
          指標表裡的 <strong>pole</strong> <Tex>{'p=1-\\mu x^2'}</Tex> 就是手算表最後一欄那個數：每走一步，參數誤差{' '}
          <Tex>{'\\delta_n=a-w_n'}</Tex> 剩下原來的 <Tex>{'p'}</Tex> 倍（手算例是 <Tex>{texNum(fixedXPole(HAND_CALC_PARAMS.mu, HAND_CALC_PARAMS.x))}</Tex>）。
          <Tex>{'|p|<1'}</Tex> 誤差才會越來越小。動手之前先看一張地圖，知道 <Tex>{'\\mu'}</Tex> 落在哪一段會看到什麼：
        </p>
        <ChapterDiagram name="CHART_MU_REGIONS">
          <p>
            先看最上面兩格：選定 <Tex>{'\\mu'}</Tex> 之後，先算出 <Tex>{'p=1-\\mu x^2'}</Tex>。再看菱形分出去的五條線：每條線上寫著 <Tex>{'\\mu'}</Tex> 的範圍和對應的 <Tex>{'p'}</Tex>。<Tex>{'\\mu'}</Tex> 越大，<Tex>{'p'}</Tex> 越小，從{' '}
            <Tex>{'1'}</Tex> 一路降到 <Tex>{'-1'}</Tex> 以下，行為也跟著換一格。
          </p>
          <p>
            圖上的「<Tex>{'p'}</Tex>」就是指標表的 pole，「<Tex>{'1/x^2'}</Tex>」「<Tex>{'2/x^2'}</Tex>」在 <Tex>{`x=${texNum(DEFAULT_BASE.x)}`}</Tex> 時是{' '}
            <Tex>{texNum(1 / (DEFAULT_BASE.x * DEFAULT_BASE.x))}</Tex> 與 <Tex>{texNum(muMax)}</Tex>。所以 Case A（<Tex>{texNum(DEFAULT_MUS[0])}</Tex>）與 Case B（
            <Tex>{texNum(DEFAULT_MUS[1])}</Tex>）落在「單調收斂」，Case C（<Tex>{texNum(DEFAULT_MUS[2])}</Tex>）落在紅色的「不收斂」。為什麼分界剛好是這幾個數，§0.6 的{' '}
            <FigRef name="CHART_ERROR_RECURSION" /> 與等比數列推導會證明。
          </p>
        </ChapterDiagram>
        <IntroPlayground />
      </Section>

      <WhyExSection />
      <NoiseAverageSection />
      <WhyMattersSection />
      <SignTeaserSection />
      <AssumptionsSection />
      <QuizSection />
      <RecapSection />
      <LearningMapSection />
      <SymbolsSection />
    </div>
  )
}
