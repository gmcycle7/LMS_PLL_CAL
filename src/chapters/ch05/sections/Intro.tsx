import { useMemo } from 'react'
import { Callout, ClaimTag, Section, SourceTag, SystemMap, Tex } from '@/components'
import { normPdf } from '@/simulation/core'
import { directionOutcomeExact, meanQ, pPlus, sumMoments, varQ } from '@/simulation/models/comparator'
import { Erratum, Fig, fx, int, sig } from '../common'
import { CH05_SYSTEM_FOCUS } from '../diagrams'
import { SymbolsLink } from '../symbols'
import { ExpectationPrereq, GaussianPrereq } from './Probability'

/** 開場：問題、系統地圖（你在這裡）、直覺與路線圖、L1 模型方塊圖、先算一次。符號表在章末（../symbols.tsx）。 */
export function IntroSection() {
  const ex = useMemo(() => {
    const s = 1
    const sigma = 100
    const r = s / sigma
    const p = pPlus(s, sigma)
    const pTaylor = 0.5 + r * normPdf(0)
    const m = meanQ(s, sigma)
    const rows = [1, 101, 10001, 1000001].map((N) => ({ N, ...sumMoments(N, m), correct: directionOutcomeExact(p, N, 'strict').correct }))
    // 「偏一點點的硬幣」：擲 100 次與 100 萬次時，正面比反面多幾次（平均）與運氣造成的起伏（SD）
    const coin = [100, 1_000_000].map((N) => ({ N, ...sumMoments(N, m) }))
    return { r, p, pTaylor, m, v: varQ(m), rows, coin }
  }, [])

  return (
    <>
      <SymbolsLink />

      <Callout kind="info" title="這次我們要回答的問題">
        <p className="ch05-question">
          PLL 裡 reference 端的 DTC 補償還差一點點，PD 的輸出裡因此有 <Tex>{String.raw`s=1\,\mathrm{fs}`}</Tex> 的時間誤差；但同一個輸出還混著{' '}
          <Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex> RMS 的雜訊。1-bit comparator（bang-bang）取這個 PD 輸出的正負號，每次只告訴你「早」或「晚」（
          <Tex>{'q=\\pm1'}</Tex>）。<strong>單一次的 <Tex>{'q'}</Tex> 幾乎就是擲硬幣，那方向資訊到底還在不在？要累加幾次才看得出來？</strong>
        </p>
      </Callout>

      <SystemMap focus={CH05_SYSTEM_FOCUS} />
      <p className="ch05-system-map-note">
        <strong>你在這裡：</strong>藍色的三個方塊——comparator 前的雜訊 <Tex>{'v[n]'}</Tex>、1-bit comparator、GMAC 累加器——是本章的主角。前幾章把 comparator
        當成理想的 <Tex>{'\\operatorname{sign}(\\cdot)'}</Tex>；這一章補上「有雜訊時，一個 bit 還剩多少資訊」：輸出 <Tex>{'+1'}</Tex> 的機率、平均輸出、累加{' '}
        <Tex>{'N'}</Tex> 次之後的訊號雜訊比，以及之後所有迴路分析都會用到的等效增益 <Tex>{'K_q'}</Tex>。
      </p>

      <Section kind="intuition" level={2} title="直覺：一枚只偏一點點的硬幣">
        <p>
          想像一枚被動過手腳的硬幣：正面的機率是 {fx(100 * ex.p, 2)}%、反面 {fx(100 * (1 - ex.p), 2)}%。擲<strong>一次</strong>，你完全看不出它偏哪一邊。擲{' '}
          {int(ex.coin[0].N)} 次，正面平均只比反面多 {fx(ex.coin[0].meanSum, 1)} 次，可是「運氣」造成的起伏有 <Tex>{'\\pm'}</Tex>
          {fx(ex.coin[0].sdSum, 0)} 次左右——還是看不出來。但是擲 {int(ex.coin[1].N)} 次，正面平均多出 {int(ex.coin[1].meanSum)} 次，運氣的起伏只有{' '}
          <Tex>{'\\pm'}</Tex>
          {int(ex.coin[1].sdSum)} 次：偏向一清二楚。
        </p>
        <p>
          1-bit comparator 就是這枚硬幣。誤差 <Tex>{'s'}</Tex> 決定「偏多少」，雜訊 <Tex>{'\\sigma_v'}</Tex> 決定「有多像公平硬幣」。本章要算的三件事：
          <strong>① 偏多少</strong>（<Tex>{'P(q=+1)'}</Tex> 與 <Tex>{'E[q]'}</Tex>，§2）、<strong>② 要擲幾次才看得出來</strong>（<Tex>{'N'}</Tex>，§3–§4）、
          <strong>③ 這個「偏」和誤差成正比的比例常數</strong>（<Tex>{'K_q'}</Tex>，§5）。上面這些數字就是用{' '}
          <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex> 由本站模擬核心算出來的。<SourceTag kind="illustrative" />
        </p>
        <p>這三件事和後面幾節的關係，先用一張路線圖看一遍，再開始算：</p>
        <Fig name="roadmap">
          先跟著「§2 → §3 → §4」這條線走：§2 算出單一次比較的機率 <Tex>{'p'}</Tex> 與平均 <Tex>{'m'}</Tex>，§3 把 <Tex>{'N'}</Tex> 次加起來，§4 反過來問「要幾次」，
          §6、§8 用實驗與不同算法互相驗證。再看從 §2 分出去的另一條線「§5 → §7 → §9」：同一個 <Tex>{'m'}</Tex> 對誤差的斜率就是 §5 的 <Tex>{'K_q'}</Tex>，§7
          把它放進逐 sample 的迴路，最後 §9 得到 block 校正迴路的 pole <Tex>{'p_{\\mathrm{cal}}'}</Tex> 與收斂後係數的抖動 <Tex>{'\\sigma_w'}</Tex>。圖上的{' '}
          <Tex>{'\\mu'}</Tex> 是學習率（每次更新的步長）、<Tex>{'z'}</Tex> 是由目標正確率查常態表得到的倍數，兩者分別在 §7 與 §4 正式登場。
        </Fig>
      </Section>

      <Section kind="diagram" level={2} title="0. 模型：一個固定誤差 + 雜訊 → 1-bit → 累加">
        <p>
          把章首系統地圖裡藍色的那一段單獨拿出來，就是下面這張圖。它是 PLL 校正迴路（Ch04）裡「PD → GMAC」的最小模型（comparator 取的是 PD 的輸出，也就是送進 loop filter 的同一個訊號）：把 regressor{' '}
          <Tex>{'x'}</Tex>（乘在誤差上的已知訊號，例如 DTC code）固定成 <Tex>{'x\\equiv1'}</Tex>，問題就只剩下「
          <strong>一個很小的偏移，經過 1-bit 量化之後，平均還保留多少？</strong>」。之後章節的 <Tex>{'K_q'}</Tex>、loop gain、noise 全部從這裡出發。
        </p>
        <Fig name="l1Model">
          先看左邊：固定誤差 <Tex>{'s'}</Tex> 與雜訊 <Tex>{'v'}</Tex> 在加法點相加，成為 comparator 的輸入 <Tex>{'e=s+v'}</Tex>（放進 PLL 裡，這個加法點就是 PD，<Tex>{'e'}</Tex> 就是 PD 的輸出）。再看中間：comparator 把{' '}
          <Tex>{'e'}</Tex> 和門檻 <Tex>{'\\theta'}</Tex> 比較，只輸出一個 bit <Tex>{'q=\\pm1'}</Tex>。最後看右邊：累加器把 <Tex>{'N'}</Tex> 個 <Tex>{'q'}</Tex>{' '}
          加成 <Tex>{'S_N'}</Tex>，取它的正負號當作「誤差是正還是負」的判斷。
        </Fig>
        <p>圖上每個名字的意思（符號第一次出現，先在這裡說清楚；完整的表在章末）：</p>
        <ul>
          <li>
            <Tex>{'s'}</Tex>：要辨識正負號的固定誤差，單位 <Tex>{'\\mathrm{fs}'}</Tex>。因為 <Tex>{'x\\equiv1'}</Tex>，它就是剩餘的參數誤差{' '}
            <Tex>{'\\delta=a-w'}</Tex>，其中 <Tex>{'a'}</Tex> 是理想係數（真值）、<Tex>{'w'}</Tex> 是目前的校正係數（全站約定 <Tex>{'\\delta=a-w'}</Tex>，不是{' '}
            <Tex>{'w-a'}</Tex>）。
          </li>
          <li>
            <Tex>{'v'}</Tex>：comparator 前的雜訊。本章假設它是平均為 0 的 Gaussian、RMS 為 <Tex>{'\\sigma_v'}</Tex>、每個樣本彼此獨立（iid），寫成{' '}
            <Tex>{'v\\sim\\mathcal N(0,\\sigma_v^2)'}</Tex>。
          </li>
          <li>
            <Tex>{'e=s+v'}</Tex>：comparator 的輸入（在 PLL 裡就是 PD 的輸出）；<Tex>{'\\theta'}</Tex>：comparator 的 threshold／offset（理想是 0，單位 <Tex>{'\\mathrm{fs}'}</Tex>）。
          </li>
          <li>
            <Tex>{'q=\\pm1'}</Tex>：comparator 的輸出（<Tex>{'e\\ge\\theta'}</Tex> 時是 <Tex>{'+1'}</Tex>）。硬體給的其實是 0/1 位元 <Tex>{'b'}</Tex>，要先映射成{' '}
            <Tex>{'q=2b-1'}</Tex>（§2 會說明為什麼）。
          </li>
          <li>
            <Tex>{'S_N=\\sum_{i=1}^{N}q_i'}</Tex>：<Tex>{'N'}</Tex> 個 <Tex>{'q'}</Tex> 的總和，<Tex>{'N'}</Tex> 是累加的樣本數；<Tex>{'S_N=0'}</Tex>{' '}
            的平手情況叫 tie，怎麼處理（tie rule）留到 §3。
          </li>
          <li>
            時間索引：<Tex>{'n'}</Tex> 數 comparator 的 sample，<Tex>{'k'}</Tex> 數 GMAC 的 block（每 <Tex>{'N'}</Tex> 個 sample 一個 block）；本章大部分只用到{' '}
            <Tex>{'n'}</Tex>。
          </li>
        </ul>
      </Section>

      <Section
        kind="example"
        level={2}
        title={
          <>
            1. 先算一次：<Tex>{String.raw`s=1\,\mathrm{fs},\;\sigma_v=100\,\mathrm{fs}`}</Tex>
          </>
        }
      >
        <p>
          先不推導，直接用數字感受一下（所有數字都由本站的模擬核心即時計算）。<SourceTag kind="illustrative" /> 表中用到的{' '}
          <Tex>{'\\Phi'}</Tex>（標準常態分布的累積機率 CDF）、<Tex>{'\\varphi'}</Tex>（它的機率密度 PDF）、期望值 <Tex>{'E[\\cdot]'}</Tex>（做很多次的平均）與變異數{' '}
          <Tex>{'\\operatorname{Var}(\\cdot)'}</Tex>（離平均有多散）若不熟，先展開下面兩個先備知識框（§2 會再一步一步推導每一列）。
        </p>
        <Fig name="firstCalc">
          先看編號 ①–⑤ 的五格：由 <Tex>{'s'}</Tex> 與 <Tex>{'\\sigma_v'}</Tex> 算出標準化誤差 <Tex>{'r=s/\\sigma_v'}</Tex>，再得到輸出 <Tex>{'+1'}</Tex> 的機率{' '}
          <Tex>{'p'}</Tex>、平均輸出 <Tex>{'m=E[q]'}</Tex> 與單次的雜訊功率 <Tex>{'\\operatorname{Var}(q)'}</Tex>——這五格就是下面第一張表的五列。再看「訊號」「雜訊」兩格：給定樣本數{' '}
          <Tex>{'N'}</Tex>，訊號是 <Tex>{'E[S_N]=Nm'}</Tex>、雜訊是標準差 <Tex>{'\\mathrm{SD}(S_N)'}</Tex>，兩者相除叫統計 SNR（
          <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}'}</Tex>）——這是第二張表的每一欄。
        </Fig>
        <GaussianPrereq />
        <ExpectationPrereq />
        <div className="table-wrap">
          <table className="ch05-table">
            <thead>
              <tr>
                <th>步驟</th>
                <th>算式</th>
                <th className="num">數值</th>
                <th>白話</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>① 標準化</td>
                <td>
                  <Tex>{'r=s/\\sigma_v'}</Tex>
                </td>
                <td className="num">{sig(ex.r)}</td>
                <td>誤差只有雜訊的 1%</td>
              </tr>
              <tr>
                <td>② 輸出 +1 的機率</td>
                <td>
                  <Tex>{String.raw`p=\Phi(0.01)\approx\tfrac12+0.01\,\varphi(0)`}</Tex>
                </td>
                <td className="num">
                  {fx(ex.pTaylor, 8)}（泰勒）
                  <br />
                  {fx(ex.p, 8)}（精確）
                </td>
                <td>
                  比 50% 多 {fx(100 * (ex.p - 0.5), 4)} 個百分點 <ClaimTag kind="exact" />
                </td>
              </tr>
              <tr>
                <td>
                  ③ 輸出 <Tex>{'-1'}</Tex> 的機率
                </td>
                <td>
                  <Tex>{'1-p'}</Tex>
                </td>
                <td className="num">{fx(1 - ex.p, 8)}</td>
                <td>單次幾乎是擲硬幣</td>
              </tr>
              <tr>
                <td>④ 平均輸出</td>
                <td>
                  <Tex>{'m=E[q]=2p-1'}</Tex>
                </td>
                <td className="num">{fx(ex.m, 8)}</td>
                <td>不是 0！方向資訊就藏在這裡</td>
              </tr>
              <tr>
                <td>⑤ 單次的雜訊</td>
                <td>
                  <Tex>{'\\operatorname{Var}(q)=1-m^2'}</Tex>
                </td>
                <td className="num">{fx(ex.v, 8)}</td>
                <td>每次的「雜訊功率」幾乎是滿的 1</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          單一樣本的訊號雜訊比（平均除以標準差）只有 <Tex>{`m/\\sqrt{1-m^2}\\approx${fx(ex.m / Math.sqrt(ex.v), 5)}`}</Tex>：雜訊大約是訊號的{' '}
          {int(Math.sqrt(ex.v) / ex.m)} 倍。可是把 <Tex>{'N'}</Tex> 個 <Tex>{'q'}</Tex> 加起來，
          <strong>
            訊號 <Tex>{'Nm'}</Tex> 隨 <Tex>{'N'}</Tex> 線性成長，雜訊只隨 <Tex>{'\\sqrt N'}</Tex> 成長
          </strong>
          。下表的 <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}=E[S_N]/\\mathrm{SD}(S_N)'}</Tex> 就是兩者的比值（<Tex>{'\\mathrm{SD}'}</Tex> 是標準差）：
        </p>
        <div className="table-wrap">
          <table className="ch05-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'N'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'E[S_N]=Nm'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\mathrm{SD}=\\sqrt{N(1-m^2)}'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}'}</Tex>
                </th>
                <th className="num">
                  精確 <Tex>{'P(\\text{判對})=P(S_N>0)'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {ex.rows.map((r) => (
                <tr key={r.N}>
                  <td className="num">{int(r.N)}</td>
                  <td className="num">{sig(r.meanSum, 5)}</td>
                  <td className="num">{sig(r.sdSum, 5)}</td>
                  <td className="num">{fx(r.snr, 4)}</td>
                  <td className="num">{fx(100 * r.correct, 2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ch05-note">
          表中 <Tex>{'N'}</Tex> 都取奇數，所以 <Tex>{'S_N'}</Tex> 不可能等於 0、沒有平手（tie）的問題；偶數 <Tex>{'N'}</Tex> 的陷阱留到 §3 再談。
          <Erratum id="E02" />
        </p>
        <Callout kind="ok" title="第一個結論">
          1-bit 量化並沒有把 <Tex>{'1\\,\\mathrm{fs}'}</Tex> 的資訊「丟掉」，只是把它變成{' '}
          <Tex>{`p-\\tfrac12\\approx${fx(100 * (ex.p - 0.5), 3)}\\%`}</Tex> 的機率偏差；需要很多樣本才能把它從雜訊裡平均出來。
          <ClaimTag kind="exact" />（指定模型：<Tex>{'s'}</Tex> 固定、<Tex>{'v'}</Tex> iid Gaussian）
        </Callout>
      </Section>
    </>
  )
}
