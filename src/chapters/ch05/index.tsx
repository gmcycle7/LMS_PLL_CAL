import { Tex } from '@/components'
import { Fig } from './common'
import { ComparatorLab } from './experiments/ComparatorLab'
import { AccumulationSection } from './sections/Accumulation'
import { CompareSection } from './sections/Compare'
import { ConfidencePrereq } from './sections/Confidence'
import { DitherSection } from './sections/Dither'
import { GainSection } from './sections/Gain'
import { IntroSection } from './sections/Intro'
import { ProbabilitySection } from './sections/Probability'
import { SamplesSection } from './sections/Samples'
import { WrapUpSection } from './sections/WrapUp'
import { ChapterSymbols } from './symbols'
import './chapter.css'

/**
 * Ch05「1-bit Comparator：雜訊下仍保留的資訊」（規格 §5、§5.1；ChatGPT 入門課第 4 課）。
 * 勘誤：E02（偶數 N 的 tie）、E07（S_N 與 tie rule）、E18（sum vs average）。
 * 驗收：T04（P(q=+1)、K_q）、T05（N ≈ 42,500 → 95%）。
 * 版面（docs/teaching-style.md §5、§8）：章首放系統地圖（IntroSection），每個主要概念先放方塊圖（diagrams.ts）再推導，
 * 符號表放在頁面最後（ChapterSymbols，id="symbols"），章首只留一行連結。
 */
export default function Chapter05() {
  return (
    <div className="ch05">
      <IntroSection />
      <ProbabilitySection />
      <AccumulationSection />
      <SamplesSection />
      <GainSection />
      <section aria-label="6. Comparator Lab">
        <h2>6. 動手做：Comparator Lab</h2>
        <p className="ch05-note">
          試試看：① 載入 preset「偶數 N = 100 的 tie」，再把 <Tex>{'N'}</Tex> 從 100 改成 101，看 strict rule 的正確率從 49% 跳回 53%；② <Tex>{'\\theta'}</Tex> 調到{' '}
          <Tex>{String.raw`2\,\mathrm{fs}`}</Tex>，看 <Tex>{'N'}</Tex> 越大越確定地判錯；③ <Tex>{'\\sigma_v'}</Tex> 設為 0，看 S 曲線變階梯；④ 新增 Case B 把 tie rule 換成{' '}
          <Tex>{'\\operatorname{sign}(0)=+1'}</Tex>，比較兩條鋸齒；⑤ 把「累加量的尺度」切到 average，看 histogram 與信賴帶的軸縮小 <Tex>{'N'}</Tex> 倍（勘誤 E18）。
        </p>
        <p>
          實驗同時用三種方式回答同一個問題，並自動互相核對。Monte Carlo 重複 <Tex>{'T'}</Tex> 次獨立的試驗（trial），數出其中判對的次數 <Tex>{'k'}</Tex>，估計判對率{' '}
          <Tex>{'\\hat P=k/T'}</Tex>；解析的一邊則由精確 Binomial 的判對機率 <Tex>{'P'}</Tex>，預測 <Tex>{'k'}</Tex> 應該落在哪個範圍（接受域{' '}
          <Tex>{'[k_{\\mathrm{lo}},k_{\\mathrm{hi}}]'}</Tex>）：
        </p>
        <Fig name="mcCheck">
          先看 Monte Carlo 那條路：<Tex>{'T'}</Tex> 次 trial 數出 <Tex>{'k'}</Tex>，得到估計值 <Tex>{'\\hat P'}</Tex> 與它的 Wilson 誤差棒。再看解析那條路：如果解析值{' '}
          <Tex>{'P'}</Tex> 是對的，<Tex>{'k'}</Tex> 應該服從 <Tex>{'\\mathrm{Bin}(T,P)'}</Tex>，由此定出接受域。最後看菱形：<Tex>{'k'}</Tex> 落在接受域內就是 <code>ok</code>，否則是{' '}
          <code>mismatch</code>。圖上的 Wilson 區間就是下面先備知識框的 F-05.14。
        </Fig>
        <ConfidencePrereq />
        <ComparatorLab />
      </section>
      <DitherSection />
      <CompareSection />
      <WrapUpSection />
      <ChapterSymbols />
    </div>
  )
}
