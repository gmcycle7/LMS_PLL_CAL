import { ClaimTag, ModelLevel, Prereq, Section, SourceTag, SymbolTable, Tex, TestBadge, ChRef } from '@/components'
import './chapter.css'
import { Erratum, SYMBOLS_ID, md } from './common'
import { CH12_SYMBOLS } from './symbols'
import { S1Intro } from './sections/S1Intro'
import { S2Recursion } from './sections/S2Recursion'
import { S3Bandwidth } from './sections/S3Bandwidth'
import { S4Mixing } from './sections/S4Mixing'
import { S5Paths, S5Spur } from './sections/S5PllSpur'
import { S6Wrap } from './sections/S6Wrap'
import { LmsNoiseLab } from './experiments/LmsNoiseLab'
import { CodeSpectraLab } from './experiments/CodeSpectraLab'
import { CodeMixingLab } from './experiments/CodeMixingLab'

/**
 * 第 12 章：Comparator Noise 如何經 LMS 變成 PLL Jitter / Spurs（規格 §12；入門課第 12 課）。
 * 套用勘誤 E06、E09、E10、E26、E27、E28、E29、E30、E33。
 * 版面（docs/teaching-style.md §2、§5、§8、§9）：章首是 12.0 的開場問題與系統地圖（本章資訊、先備自檢由 PageFrame 放在地圖之後；
 * 勘誤清單與「先備章節」原本各自寫在章首，現在都在那條 strip 與先備自檢裡）；符號表是整頁的最後一個區塊（id="symbols"，在「本課必記」與「連結到硬體」之後）。
 */
export default function Chapter12() {
  return (
    <article className="ch12">
      <Section kind="intuition" title="12.0 問題與地圖" level={2} id="ch12-start">
        <S1Intro
          afterMap={
            <>
              <div className="c-tag-row">
                <ModelLevel level="L1" />
                <ModelLevel level="L4" />
                <SourceTag kind="illustrative" />
                <TestBadge id="T13" />
                <TestBadge id="T14" />
                <TestBadge id="T15" />
              </div>
              <p>
                規格 §12。前面幾章把 LMS 調到「平均正確」（<ChRef ch="03">第 3 章</ChRef>的 mean stability、<ChRef ch="05">第 5 章</ChRef>的 comparator 增益、<ChRef ch="08">第 8 章</ChRef>的 phase margin、<ChRef ch="11">第 11 章</ChRef>的 bias）。這一章處理收斂<strong>之後</strong>剩下的東西：comparator 的隨機判斷讓係數持續抖動，這個抖動經過「乘上 code」與「PLL 的轉移函數」才變成輸出的 jitter 或 spur。本章所有先備數學（期望值、Z-transform、PSD、卷積、Bessel）都在可展開的「先備知識」框內從頭說明。
              </p>
              <p className="small">
                本章負責的勘誤一句話版：<Erratum id="E27" />（−3 dB 頻寬不等於 ENBW；近似的誤差與存在範圍要分開說）、<Erratum id="E28" />（PSD 的正規化）、<Erratum id="E29" />（multirate：係數雜訊在 block rate 產生、在 sample rate 乘上 code），以及 <Erratum id="E06" />、<Erratum id="E26" />；全站性的 <Erratum id="E09" />、<Erratum id="E10" />、<Erratum id="E30" />（T13 的完整條件）、<Erratum id="E33" />（係數偏差 <Tex>{String.raw`\delta w=w-w^*`}</Tex> 的極性）也在本章用到。每一條在正文第一次用到的地方會再標一次；完整說明在驗證頁的勘誤瀏覽器（上方本章資訊的「勘誤」）。
              </p>
            </>
          }
        />
      </Section>

      <Section kind="formula" title="12.1–12.4 從 comparator noise 到係數雜訊的 RMS" level={2} id="ch12-sigma">
        <S2Recursion />
      </Section>

      <Section kind="formula" title="12.5 頻寬的四個定義（T14）" level={2} id="ch12-bw">
        <S3Bandwidth />
      </Section>

      <Section kind="explore" title="實驗 1：LMS Noise Lab（T13 / T14）" level={2} id="ch12-lab-noise">
        <p>
          <ClaimTag kind="exact" /> 解析值在線性模型下精確；三個 Monte Carlo 引擎檢驗線性化本身。Gallery preset #8 直接載入規格 §12.1 的例子。
        </p>
        <Prereq title="Monte Carlo、seed、95% 信賴區間與 Welch PSD">
          <p>
            <strong>Monte Carlo</strong>：公式算的是「期望值」，模擬則是真的用亂數把隨機過程跑很多次，再統計結果。亂數由 <strong>seed</strong> 決定——同一個 seed 會得到完全相同的序列，所以結果可以重現；換一個
            seed 就是另一次獨立實驗。一條獨立的模擬序列稱為一條 <strong>chain</strong>。
          </p>
          <p>
            <strong>95% 信賴區間（CI）</strong>：有限長度的模擬只能給出估計值 <Tex>{String.raw`\hat\sigma_w`}</Tex>，它本身會隨 seed 起伏。CI 是一個由資料算出的區間{' '}
            <Tex>{String.raw`[\hat\sigma_{\mathrm{lo}},\hat\sigma_{\mathrm{hi}}]`}</Tex>：如果把整個實驗重複很多次，約 95% 的區間會蓋住真值。所以「CI 涵蓋解析值」表示模擬與公式沒有矛盾；反過來，約每 20 個 seed 就會有一次沒蓋住——那是統計上正常的事，不是 bug。blocks 或 chains 越多，區間越窄（寬度 <Tex>{String.raw`\propto1/\sqrt{\text{樣本數}}`}</Tex>）。
          </p>
          <p>
            <strong>Welch PSD</strong>：估計頻譜的標準做法——把長序列切成許多段，每段乘上 window（本實驗用 Hann）後做 FFT、取 <Tex>{String.raw`|\cdot|^2`}</Tex>，再把各段平均。平均降低估計的起伏，代價是頻率解析度變成{' '}
            <Tex>{String.raw`f_u/\text{nperseg}`}</Tex>。
          </p>
        </Prereq>
        <LmsNoiseLab />
      </Section>

      <Section kind="formula" title={String.raw`12.6 Gain noise $\times$ code：頻譜混合`} level={2} id="ch12-mix">
        <S4Mixing />
      </Section>

      <Section kind="formula" title="12.7 PLL 的兩個出口：PD 與 output" level={2} id="ch12-pll">
        <S5Paths />
      </Section>

      <Section kind="explore" title="實驗 2：Code Spectra Lab（三種 code、PD vs output）" level={2} id="ch12-lab-codes">
        <CodeSpectraLab />
      </Section>

      <Section kind="formula" title="12.8 Spur 與 noise skirt（T15）" level={2} id="ch12-spurs">
        <S5Spur />
      </Section>

      <Section kind="explore" title="實驗 3：Code Mixing Lab（T15）" level={2} id="ch12-lab-mixing">
        <p>{md(String.raw`Gallery preset #9：$13\ \mathrm{GHz}$ output、$0.5\ \mathrm{fs}$ peak tone $\Rightarrow -93.8\ \mathrm{dBc}$。用 Case A / B / C 對照 tone $\times$ tone、code 有 DC、隨機係數雜訊三種情境。`)}</p>
        <CodeMixingLab />
      </Section>

      <Section kind="assumptions" title="12.9 比較、思考題與本課必記" level={2} id="ch12-wrap">
        <S6Wrap />
      </Section>

      <section id={SYMBOLS_ID} className="ch12-symbols" aria-label="本章符號表">
        <h2 className="ch12-symbols-title">本章符號表</h2>
        <SymbolTable
          rows={CH12_SYMBOLS}
          title="依第一次出現的小節排列"
          caption={md(String.raw`時間索引：$n$ = comparator sample（取樣率 $f_s$），$k$ = GMAC block（取樣率 $f_u=f_s/N$）。PSD 預設單邊 per-Hz。極性：$\delta w=w-w^*$（與 §0 的 $\delta=a-w$ 相反）。「首次出現」欄是正文第一次用到、並就地說明這個符號的小節；有箭頭的（例如 §12.0 → §12.7）表示章首的地圖先用一句話交代，正式的定義或推導在箭頭後面的小節。`)}
        />
      </section>
    </article>
  )
}
