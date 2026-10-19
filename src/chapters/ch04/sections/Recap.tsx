import { Callout, ClaimTag, Recap, Section, Tex, ChRef } from '@/components'

const R = String.raw

/**
 * §8 本課必記與連結到 PLL：章末、符號表之前。放在 Part 2 的摺疊框外面，Beginner 模式也看得到
 * （Recap 列的是整章的公式：Part 1 的 F-04.1–F-04.7 與 Part 2 的 F-04.9–F-04.18）。內容原本在 §7 的尾端，2026-10-19 拆章時搬過來，文字不變。
 */
export function RecapSection() {
  return (
    <Section kind="example" title="§8 本課必記與連結到 PLL" level={2} id="ch04-recap">
      <Recap
        title="這一課最重要的公式"
        formulas={[
          { tex: R`r[n]=\sum_{m\le n}(y[m]-\mathrm{frac})=-\frac{s[n]}{M},\qquad\tau_\mathrm{need}=\frac{s[n]}{M}T_\mathrm{vco},\qquad\tau_\mathrm{DTC}=T_0-w\,x[n]`, label: 'DTC 要補償的是 DSM 累加器內容；reference 端的 DTC 從基準延遲往回扣（F-04.1、F-04.2）' },
          { tex: R`E[G_k]\approx K_qC\,\delta_k,\qquad g_\mathrm{avg}=\mu K,\qquad g_\mathrm{sum}=N\mu K`, label: R`GMAC 平均與 sum / average 的 $N$ 倍差異（F-04.4、F-04.5）` },
          { tex: R`q=2b-1;\quad G_\mathrm{bug}=\tfrac12G+\tfrac12\bar x_\mathrm{ref}`, label: '0/1 映射（F-04.7）' },
          { tex: R`B_\mathrm{acc}=1+\lceil\log_2(NM_x+1)\rceil\;\overset{N=2^m}{=}\;B_x+m\;(+1\text{ 若含最負 code})`, label: '累加器位元數（F-04.9）' },
          { tex: R`w^*-a=\frac{\bar\varepsilon\,\Delta_G}{K}+\frac{\bar\varepsilon_W\Delta_W}{g},\qquad\bar\varepsilon_\mathrm{floor}=-\frac{1-2^{-\ell}}{2}`, label: '兩個截斷點的 rounding 偏差（F-04.10、F-04.11、F-04.18）' },
        ]}
        points={[
          <>
            DTC 在 reference 的輸入端，回授路徑上只有 divider。feedback edge 早到的時間就是 DSM 累加器裡的數字；DTC 把 reference edge 也提前（從基準延遲 <Tex>{R`T_0`}</Tex> 少延遲）<Tex>{R`w\,x[n]`}</Tex> 去對齊。DTC gain 誤差{' '}
            <Tex>{R`\delta`}</Tex> 讓 PD 看到 <Tex>{R`\delta\,x[n]`}</Tex>，這正是 LMS 的 <Tex>{R`y=ax`}</Tex> 問題。
          </>,
          <>LMS 校正迴路的輸入是 PD 的輸出 <Tex>{R`e[n]`}</Tex>：comparator 取的是送進 loop filter 的同一個訊號。</>,
          <>GMAC 是相關的樣本估計：<Tex>{R`E[G]\approx K_qC\delta`}</Tex>。總和寫 <Tex>{R`S`}</Tex>、平均寫 <Tex>G</Tex>，兩者差 <Tex>N</Tex> 倍 loop gain 與 <Tex>N</Tex> 倍標準差。</>,
          <>
            <Tex>{R`q=\pm1`}</Tex> 時不用乘法器（XOR + carry-in），但最負 code 取負要多 1 bit（否則 <Tex>{R`w^*-a\approx-p_\mathrm{min}/K`}</Tex>）；硬體 0/1 一定要映射成 <Tex>{R`\pm1`}</Tex>。
          </>,
          <>累加器位元數用最壞情況（開機時 <Tex>{R`q\approx\mathrm{sign}(x)`}</Tex>）決定；wrap 會變號，saturate 至少方向正確。</>,
          <>
            「<Tex>{R`\div N`}</Tex>」的右移截斷（floor）造成與 <Tex>{R`\mu`}</Tex> 無關的固定偏差；更新量對齊 <Tex>W</Tex> 的 LSB 時再截一次，偏差約 <Tex>{R`\Delta_W/(2g)`}</Tex>，<Tex>{R`\mu`}</Tex> 越小越大。用
            half-even 或足夠的小數位元。gain accumulator 要有 anti-windup，block 邊界一定要清除 <Tex>S</Tex>。
          </>,
        ]}
      />

      <Callout kind="info" title="連結到 PLL 與下一章">
        <ul>
          <li>
            <strong><ChRef ch="05">Ch05</ChRef></strong>：<Tex>{R`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex> 從哪來、1 fs 誤差埋在 100 fs 雜訊裡要累加多少筆（tie 規則，勘誤 E02 / E07）。
          </li>
          <li>
            <strong><ChRef ch="06">Ch06</ChRef> / <ChRef ch="07">Ch07</ChRef></strong>：<Tex>{R`C=E[x_\mathrm{ref}u]`}</Tex> 會因 PLL 的 <Tex>{R`H_\mathrm{PD}`}</Tex> 相位或 code 錯位而變號——本章假設 <Tex>{R`C>0`}</Tex>。
          </li>
          <li>
            <strong><ChRef ch="08">Ch08</ChRef></strong>：本章 latency 計算器的 <Tex>{R`g_\mathrm{crit}=2\sin\frac{\pi}{4d+2}`}</Tex> 與真正的 calibration phase margin。
          </li>
          <li>
            <strong><ChRef ch="12">Ch12</ChRef> / <ChRef ch="13">Ch13</ChRef></strong>：GMAC 雜訊經 <Tex>{R`\mu`}</Tex> 變成 gain noise（<Tex>{R`\sigma_w`}</Tex>）、實體 gain 只有 6 bits 時的量化與 limit cycle。
          </li>
        </ul>
        <p className="small">
          <ClaimTag kind="research" /> 本章的系統圖是教學架構，不是特定晶片的 netlist；真實晶片的 clock domain、pipeline 深度與 PD 結構需以 RTL / SPICE 確認。
        </p>
      </Callout>
    </Section>
  )
}
