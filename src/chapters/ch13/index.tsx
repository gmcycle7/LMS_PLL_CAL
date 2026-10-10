import { Callout, ClaimTag, ModelLevel, Section, TestBadge, Tex } from '@/components'
import { Erratum } from './common'
import { QuantizedGainLab } from './experiments/QuantizedGainLab'
import { CodeComparison } from './sections/CodeComparison'
import { CriteriaSection } from './sections/Criteria'
import { DeltaSigmaSection } from './sections/DeltaSigma'
import { DitherSection } from './sections/Dither'
import { FreezeSection } from './sections/Freeze'
import { Intro } from './sections/Intro'
import { NonIdealSection } from './sections/NonIdeal'
import { StochasticSection } from './sections/Stochastic'
import { TimeVaryingSection } from './sections/TimeVarying'
import { ToggleSection } from './sections/Toggle'
import { WrapUp } from './sections/WrapUp'
import './chapter.css'

/**
 * 第 13 章：6-bit 校正係數——Quantization、Limit Cycle、Dither、Noise Shaping（規格 §13）。
 * 勘誤：E13（Δ_LSB）、E15（EFB limit cycle）、E47（toggle 線功率）、E49（static error 正負號）。
 * 驗收：T16、T17（src/simulation/models/quantizer.test.ts）。
 */
export default function Chapter13() {
  return (
    <div className="ch13">
      <div className="c-tag-row ch13-badges">
        <ModelLevel level="L5" />
        <TestBadge id="T16" />
        <TestBadge id="T17" />
        <Erratum id="E13" />
        <Erratum id="E15" />
        <Erratum id="E47" />
        <Erratum id="E49" />
      </div>
      <Intro />
      <FreezeSection />
      <ToggleSection />
      <StochasticSection />
      <DeltaSigmaSection />
      <DitherSection />
      <CodeComparison />
      <Section kind="explore" title="互動實驗：Quantized Gain Lab" level={2} id="ch13-lab">
        <p>
          同一 seed、同一 DSM 序列下比較五種策略（規格 §13.5 的「完整推薦實驗」與 Gallery #10）。每個結論旁的標籤：<ClaimTag kind="exact" /> 為指定模型下的代數 / 精確數值，
          <ClaimTag kind="approx" /> 為白色近似或有限樣本估計。
        </p>
        <QuantizedGainLab />
        <Callout kind="info" title="驗收測試（T16 / T17）">
          T16：常數 32.4 的 toggle 平均 32.4、週期 5、Freeze code 32 / <Tex>{String.raw`\delta w=-0.4\,\mathrm{LSB}`}</Tex>、譜線 <Tex>{String.raw`|c_{1,2}|=(\sqrt5\mp1)/10`}</Tex>，並加上 E15 的 D ≡ B
          acceptance check 與 E47 的線功率；T17：stochastic rounding 平均 32.4、變異 <Tex>{String.raw`0.24\,\mathrm{LSB}^2`}</Tex>（<Tex>{'10^6'}</Tex> 樣本、<Tex>{String.raw`\pm4\,\mathrm{SE}`}</Tex>）。兩者都和{' '}
          <code>golden/vectors/T16.json</code>、<code>T17.json</code>、<code>quantizer_first_order.json</code> 交叉比對。
        </Callout>
      </Section>
      <TimeVaryingSection />
      <CriteriaSection />
      <NonIdealSection />
      <WrapUp />
    </div>
  )
}
