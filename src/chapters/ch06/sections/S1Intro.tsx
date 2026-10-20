import { useMemo } from 'react'
import { Callout, ClaimTag, Prereq, Section, SourceTag, Tex, TexBlock, ChRef, JumpTo } from '@/components'
import { calPole, kqFromSigma, toneCorrelation, toneHandTable } from '@/simulation/models/polarity'
import { ChapterDiagram, ChapterSection, f, fx, radOf } from '../shared'

/** §1 一個問題 + 先算一次（數字先於公式）。表格中的每個數都由 toneHandTable 即時計算。 */
export function S1Intro() {
  const t = useMemo(() => toneHandTable({ A: 1, mag: 1, phiRad: radOf(120), omega: Math.PI / 6, rows: 12 }), [])
  const sum = t.xu.reduce((s, v) => s + v, 0)
  const Kq = kqFromSigma(100)
  const mu = 10
  const pBad = calPole(mu, Kq, t.mean)
  const cGood = toneCorrelation({ A: 1, mag: 1, phiRad: 0, omega: Math.PI / 6 }) // φ = 0 的同一個 code
  const pGood = calPole(mu, Kq, cGood)

  return (
    <ChapterSection id="ch06-s1" kicker="§1" title="一個問題：你推的，和 comparator 看到的，不是同一個東西">
      <div className="ch06-question">
        <div className="ch06-question-title">這一課要回答的問題</div>
        <p>
          DTC gain 校正迴路用 1-bit comparator 加 GMAC 去「學」真正的 gain <Tex>{'a'}</Tex>。但 comparator 取的是 PD 的輸出，而 PD 就在主 PLL 的迴路裡：reference
          輸入端的 DTC 一把誤差送進 PD，PLL 就會反應、會追蹤、會延遲，PD 輸出的已經不是原來的誤差。<strong>PLL 的 error transfer 會不會讓 LMS 越校越歪？</strong>
        </p>
        <p className="ch06-keypoint">
          答案：會。把 DTC 的 code 叫做 <Tex>{'x'}</Tex>、PD 實際看到的（被主 PLL 濾過的）code 叫做 <Tex>{'u'}</Tex>，兩者逐拍相乘再平均就是<strong>相關</strong>{' '}
          <Tex>{'C=E[x\\,u]'}</Tex>。在正規化的慢速單參數模型中，只要 <Tex>{'C<0'}</Tex>，任何正的 learning rate <Tex>{'\\mu'}</Tex>（每次更新的步長）都使平均誤差發散，而且
          <strong>
            把 <Tex>{'\\mu'}</Tex> 調小也救不回來
          </strong>
          （只會發散得比較慢）。 <ClaimTag kind="exact" />
        </p>
      </div>

      <Section id="ch06-analogy" kind="intuition" title="先用一個比喻">
        <p>
          想像你對著山谷喊一段有節奏的口令（這是 DTC 的 code <Tex>{'x[n]'}</Tex>），然後聽回音（這是 PD 看到的 <Tex>{'u[n]'}</Tex>）。你想判斷「我喊的方向對不對」，所以把<strong>自己喊的口令</strong>和<strong>聽到的回音</strong>逐拍相乘再平均。如果回音只是變小聲，相乘的平均仍然是正的；但如果回音<strong>晚了大半拍</strong>，你喊「高」的時候正好聽到上一拍的「低」，相乘的平均就變成負的——你會得到完全相反的結論。
        </p>
        <p>
          GMAC 就是這樣做的：它把 comparator 的正負號 <Tex>{'q[n]'}</Tex> 乘上<strong>原始</strong> code <Tex>{'x[n]'}</Tex>。但誤差在到達 comparator 之前已經被主 PLL「濾過」了，comparator 看到的是 <Tex>{'u=h*x'}</Tex>，不是 <Tex>{'x'}</Tex>（<Tex>{'h'}</Tex> 是主 PLL 對 DTC
          誤差的脈衝響應，<Tex>{'*'}</Tex> 是卷積：<Tex>{'u[n]'}</Tex> 是現在與過去幾拍的 <Tex>{'x'}</Tex> 的加權和；§2 會從頭解釋）。
        </p>
      </Section>

      <ChapterDiagram id="D-06.1">
        <p>
          先看兩條路：同一個 code <Tex>{'x[n]'}</Tex> 一份直接送到乘法器，另一份先穿過藍色的主 PLL 才變成回音 <Tex>{'u[n]'}</Tex>。再看下面的菱形：兩者逐拍相乘、平均之後只剩一個數{' '}
          <Tex>{'C'}</Tex>，校正往哪個方向走，就看它的正負號。
        </p>
        <p>
          對照下面的手算表：圖上藍色方塊的輸出就是表中 <Tex>{'u[n]=x[n]-\\sqrt3\\,x[n-1]'}</Tex> 那一欄，「×」就是最後一欄 <Tex>{'x[n]\\,u[n]'}</Tex>，「取平均」就是表下方的{' '}
          <Tex>{'C=\\tfrac{1}{12}\\sum_n x[n]\\,u[n]'}</Tex>。
        </p>
      </ChapterDiagram>

      <Section id="ch06-hand12" kind="example" title="先算一次：12 個 sample 的手算">
        <p>
          假設主 PLL 對 DTC 誤差的整體效果剛好是一個兩拍濾波器（真實 PLL 不是，但這讓我們能用手算；§4 會說明它從哪裡來）：
        </p>
        <TexBlock>{String.raw`u[n]=h_0\,x[n]+h_1\,x[n-1],\qquad h_0=${fx(t.h[0], 4)},\;h_1=${fx(t.h[1], 4)}\;(=-\sqrt3)`}</TexBlock>
        <p>
          code 是單頻 <Tex>{String.raw`x[n]=\cos(\pi n/6)`}</Tex>（每 12 個 sample 一個週期）。這個濾波器在這個頻率的增益剛好是{' '}
          <Tex>{'|H|=1'}</Tex>：<strong>振幅完全沒有被衰減</strong>，只把相位轉了 <Tex>{'120^\\circ'}</Tex>。逐列計算：
        </p>
        <div className="table-wrap">
          <table className="ch06-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'n'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'x[n]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'x[n-1]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'u[n]=x[n]-\\sqrt3\\,x[n-1]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'x[n]\\,u[n]'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {t.n.map((n, i) => (
                <tr key={n}>
                  <td className="num">{n}</td>
                  <td className="num">{fx(t.x[i], 3)}</td>
                  <td className="num">{fx(t.xPrev[i], 3)}</td>
                  <td className="num">{fx(t.u[i], 3)}</td>
                  <td className={`num ${t.xu[i] < -1e-9 ? 'neg' : t.xu[i] > 1e-9 ? 'pos' : ''}`}>{fx(t.xu[i], 3)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              由 <code>toneHandTable()</code> 即時計算（訊號在 <Tex>{'n=0'}</Tex> 之前就存在，所以{' '}
              <Tex>{`x[-1]=\\cos(-\\pi/6)=${fx(t.xPrev[0], 3)}`}</Tex>）。
            </caption>
          </table>
        </div>
        <TexBlock>{String.raw`C=\frac{1}{12}\sum_{n=0}^{11}x[n]\,u[n]=\frac{${fx(sum, 4)}}{12}=${fx(t.mean, 4)}`}</TexBlock>
        <p>
          12 個乘積裡負的遠多於正的，平均是 <strong>負的</strong>。下一節會證明：GMAC 的平均輸出正比於這個 <Tex>{'C'}</Tex>，而更新的「方向」取決於它的正負號。先認識下表用到的幾個量：<Tex>{'\\delta=a-w'}</Tex> 是參數誤差（真實 gain <Tex>{'a'}</Tex> 減掉校正迴路目前的估計{' '}
          <Tex>{'w'}</Tex>）；<Tex>{'\\mu'}</Tex> 是 learning rate；<Tex>{'\\sigma_v'}</Tex> 是 comparator 前雜訊的 RMS，<Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>{' '}
          是<ChRef ch="05">第 05 章</ChRef>推導的 comparator 小訊號增益；<Tex>{'p=1-\\mu K_qC'}</Tex> 是平均誤差每過一個 GMAC block 被乘上的倍數（pole）——<Tex>{'p<1'}</Tex> 誤差縮小，
          <Tex>{'p>1'}</Tex> 誤差放大。代入<ChRef ch="05">第 05 章</ChRef>的數字（<Tex>{'\\mu=10\\,\\mathrm{fs}'}</Tex>、<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>{' '}
          ⇒ <Tex>{`K_q=${f(Kq, 6)}\\,\\mathrm{fs}^{-1}`}</Tex>）：
        </p>
        <div className="table-wrap">
          <table className="ch06-table">
            <thead>
              <tr>
                <th>路徑相位</th>
                <th className="num">
                  <Tex>{'C'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'p=1-\\mu K_qC'}</Tex>
                </th>
                <th className="num">100 個 block 後的誤差倍數</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'\\phi=0^\\circ'}</Tex>（沒有相位差）
                </td>
                <td className="num pos">{fx(cGood, 4)}</td>
                <td className="num">{fx(pGood, 5)}</td>
                <td className="num">{f(Math.pow(pGood, 100), 3)}</td>
                <td>收斂（每個 block 誤差縮小 {fx((1 - pGood) * 100, 2)}%）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\phi=120^\\circ'}</Tex>（上表）
                </td>
                <td className="num neg">{fx(t.mean, 4)}</td>
                <td className="num">{fx(pBad, 5)}</td>
                <td className="num">{f(Math.pow(pBad, 100), 3)}</td>
                <td>發散（每個 block 誤差放大 {fx((pBad - 1) * 100, 2)}%）</td>
              </tr>
            </tbody>
            <caption>
              <Tex>{`p=${fx(pBad, 7)}`}</Tex> 即規格 §17 T06 的 golden 值（反面測試：comparator 極性接反、<Tex>{'C=1'}</Tex> 時{' '}
              <Tex>{`p=1+\\mu K_q=${fx(1 + mu * Kq, 7)}`}</Tex>）。「誤差倍數」是平均誤差 <Tex>{'E[\\delta_{100}]/\\delta_0=p^{100}'}</Tex>。
            </caption>
          </table>
        </div>
        <p className="small">
          想自己動手？<JumpTo target="handcalc-HC-06.3">手算題 HC-06.3</JumpTo> 帶你算出 <Tex>{'h_0,\\,h_1'}</Tex> 與上表的任何一列；
          <JumpTo target="handcalc-HC-06.2">HC-06.2</JumpTo> 讓你換成自己的 <Tex>{'\\phi,\\ \\mu,\\ \\sigma_v'}</Tex> 重算 <Tex>{'C'}</Tex> 與 <Tex>{'p'}</Tex>（兩題都在
          §4 的推導後面）。
        </p>
        <Callout kind="danger" title="直覺">
          <p>
            相位轉超過 <Tex>{'90^\\circ'}</Tex> 時，GMAC 會把「推」誤認成「拉」：它以為誤差是正的，其實是負的，於是往<strong>錯誤的方向</strong>修正。learning rate 只決定每一步走多遠，<strong>決定不了方向</strong>——所以調小 <Tex>{'\\mu'}</Tex> 沒用。 <SourceTag kind="illustrative" />
          </p>
        </Callout>
      </Section>

      <Prereq title="怎麼讀這一章（三種學習模式）">
        <ul>
          <li>
            <strong>Beginner</strong>：先看比喻、手算表與互動圖；推導框預設收合，按一下就展開。
          </li>
          <li>
            <strong>Engineer</strong>：推導、假設、單位與硬體對應預設展開。
          </li>
          <li>
            <strong>Research</strong>：額外顯示邊界情況（E44、E46）、有限 N 的 ripple、大誤差極限、Monte Carlo 細節與反例。
          </li>
        </ul>
        <p className="small muted">
          三種模式共用同一個計算核心（<code>src/simulation/models/polarity.ts</code>），只改變呈現。
        </p>
      </Prereq>
      <p className="small">
        想先動手？直接跳到 <JumpTo target="ch06-s7">§7 Polarity Explorer</JumpTo>，把 <Tex>{'\\phi'}</Tex> 從 <Tex>{'0^\\circ'}</Tex> 拉到{' '}
        <Tex>{'180^\\circ'}</Tex>，看 <Tex>{'C'}</Tex> 與閉迴路的 <Tex>{'w'}</Tex> 怎麼變。
      </p>
    </ChapterSection>
  )
}
