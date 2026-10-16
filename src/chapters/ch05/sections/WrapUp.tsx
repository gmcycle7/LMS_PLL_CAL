import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, Prereq, Quiz, Recap, Section, SourceTag, Tex, TexBlock, ChRef } from '@/components'
import {
  blockLoopLinear,
  directionExact,
  directionOutcomeExact,
  kq,
  meanGmacEncoding,
  meanQ,
  minNForTarget,
  pPlus,
  samplesForConfidence,
  signLmsFixedPointEncoding,
  sumVarianceAr1,
  tieRuleEquilibrium,
} from '@/simulation/models/comparator'
import { Erratum, Fig, HandCalcBlock, Steps, figNo, fx, int, pct, texInt, texPct } from '../common'

/** §9：連結到 PLL、設計清單、思考題、本課必記、延伸。 */
export function WrapUpSection() {
  const v = useMemo(() => {
    const mu = 10
    // 線性化的 block 迴路摘要：與綜合手算題 HC-05.8 共用模型的 blockLoopLinear()，表格與手算不會各算各的
    const loop = blockLoopLinear(mu, 100, 10000)
    const m = meanQ(1, 100)
    const xs = [-1, -0.5, 0, 0.5, 1, 1.5]
    const ps = xs.map(() => 1 / 6)
    const p1 = pPlus(1, 100)
    const muRows = [2.5, 5, 10, 20, 50, 100, 200].map((mu2) => {
      const L = blockLoopLinear(mu2, 100, 10000)
      return { mu: mu2, g: L.g, p: L.pole, tau: L.tau, sw: L.sigmaW }
    })
    const p2 = pPlus(2, 100)
    const p200 = pPlus(1, 200)
    const corr = [0, 0.5, 0.9, 0.99].map((rho) => ({ rho, ...sumVarianceAr1(4096, rho) }))
    // 把樣本數換成時間：comparator 每個 reference 週期判決一次，f_s = 4 GHz（規格 §19.2 preset 8 的設定）
    const fsHz = 4e9
    const n95 = minNForTarget(p1, 0.95, 'odd') ?? NaN
    const n99 = minNForTarget(p1, 0.99, 'odd') ?? NaN
    const timeRows = [4096, 10001, n95, n99].map((N) => ({ N, us: (N / fsHz) * 1e6, pc: directionOutcomeExact(p1, N, 'half').correct }))
    const phases = 8
    return {
      fsHz,
      timeRows,
      phases,
      n95,
      fuKHz: fsHz / 4096 / 1e3,
      oneHotN: phases * n95,
      oneHotUs: ((phases * n95) / fsHz) * 1e6,
      muRows,
      muMax: loop.muMax,
      mu,
      g: loop.g,
      p: loop.pole,
      tau: loop.tau,
      sw10k: loop.sigmaW,
      sw4096: blockLoopLinear(mu, 100, 4096).sigmaW,
      n95s2: minNForTarget(p2, 0.95, 'odd'),
      n95s2clt: samplesForConfidence(meanQ(2, 100), 0.95),
      n95sig200: minNForTarget(p200, 0.95, 'odd'),
      K200: kq(200),
      plus100: directionOutcomeExact(p1, 100, 'plus').correct,
      strict100: directionOutcomeExact(p1, 100, 'strict').correct,
      half100: directionOutcomeExact(p1, 100, 'half').correct,
      tie100: directionExact(p1, 100).tie,
      eqPlus100: tieRuleEquilibrium(100, 100, 'plus'),
      wrongUpdate: meanGmacEncoding(300, 300, xs, ps, 100, 'unipolar'),
      wrongShift: signLmsFixedPointEncoding(300, xs, ps, 100, 'unipolar', [-700, 1300]) - 300,
      m,
      corr,
    }
  }, [])

  return (
    <>
      <Section kind="diagram" level={2} title="9. 連結到 PLL：這些數學對應哪些硬體">
        <p>
          回到章首的系統地圖：本章的每個符號在硬體上都有位置。下圖把從 reference clock 到 gain accumulator 的整條路畫出來（主 PLL 迴路加上 LMS 校正迴路），並標上本章的符號；
          <Tex>{'x[n]'}</Tex> 是 regressor（本章取 <Tex>{'x\\equiv1'}</Tex>），<Tex>{'G_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 的平均，<Tex>{'\\mu'}</Tex> 是學習率。
        </p>
        <Fig name="hwMap">
          這張圖是直式的，由上往下順著箭頭走。先看最上面的兩條 edge 怎麼在 PD 相遇：reference clock 先經過 DTC 才進 PD；DTC 只能延遲、不能提前，所以它從固定的基準延遲{' '}
          <Tex>{'T_0'}</Tex> 往回扣，扣掉的 <Tex>{'w_k\\,x[n]'}</Tex> 就是它的補償量（reference edge 少延遲這麼多，<Tex>{String.raw`\tau_{\mathrm{DTC}}=T_0-w_k\,x[n]`}</Tex>）；
          回授路徑上只有 divider、不經過 DTC，小數除頻讓它的 feedback edge 比理想時刻早到 <Tex>{'a\\,x[n]'}</Tex>。PD 量的是 reference edge 減 feedback edge：{' '}
          <Tex>{String.raw`e[n]=t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w_k)\,x[n]+v[n]=s+v[n]`}</Tex>——圖上進 PD 的三條線寫的就是這三項：DTC 那條是{' '}
          <Tex>{'-w_k\\,x[n]'}</Tex>、divider 那條是 <Tex>{'+a\\,x[n]'}</Tex>、jitter 那條是 <Tex>{'+v[n]'}</Tex>。補償不足（<Tex>{'w_k<a'}</Tex>）時 reference 還是太晚，
          <Tex>{'s'}</Tex> 為正（<Tex>{'e[n]'}</Tex> 平均偏正，單看一次仍然被 <Tex>{'v[n]'}</Tex> 蓋過）；<Tex>{'T_0'}</Tex> 是常數，被 PLL 當成靜態相位偏移吸收，所以{' '}
          <Tex>{'e[n]'}</Tex> 的式子裡沒有它。再看 PD 下面的圓角方塊「PD 輸出 <Tex>{'e[n]'}</Tex>」：同一個 <Tex>{'e[n]'}</Tex> 從這裡一路送進 loop filter（主 PLL 迴路），
          另一路用虛線分接給 1-bit comparator——LMS 校正迴路的輸入是 PD 的輸出，也就是送進 loop filter 的同一個訊號，不是從 DTC 或 divider 拉出來的。
          接著看從 comparator 到 GMAC 的前半段（每個 sample <Tex>{'n'}</Tex> 動一次）：comparator 把 <Tex>{'e[n]'}</Tex> 切成一個位元 <Tex>{'b[n]'}</Tex>，映射成{' '}
          <Tex>{'q[n]=\\pm1'}</Tex> 後進 GMAC 累加。再看 GMAC 之後的後半段（每個 block <Tex>{'k'}</Tex> 才動一次）：累加滿 <Tex>{'N'}</Tex> 個 sample 得到{' '}
          <Tex>{'S_N'}</Tex>，除以 <Tex>{'N'}</Tex>、乘 <Tex>{'\\mu'}</Tex>，加進 gain accumulator 得到新的 <Tex>{'w'}</Tex>，沿著最右邊那條線回去控制 reference 端的 DTC。
          藍色三格（comparator、位元映射、GMAC）就是本章分析的部分。最後看兩個 regressor 方塊（同一個訊號 <Tex>{'x[n]'}</Tex>，分開畫只是為了讓線不要交叉）：
          它出現在兩個地方——乘上 <Tex>{'w_k'}</Tex> 之後控制 DTC（feedback edge 早到的 <Tex>{'a\\,x[n]'}</Tex> 也是同一個 <Tex>{'x[n]'}</Tex>，所以 PD 看到的是{' '}
          <Tex>{'s=(a-w_k)\\,x[n]'}</Tex>），GMAC 累加時又乘在 <Tex>{'q[n]'}</Tex> 上（<Tex>{'S_N=\\sum q[n]\\,x[n]'}</Tex>）；本章固定 <Tex>{'x\\equiv1'}</Tex>，所以這兩條虛線都只是乘 1。
          圖上 <Tex>{'e[n]'}</Tex> 的式子寫的是注入 PD 的誤差本身：主 PLL 迴路（PD → loop filter → divider → PD 那一圈）會跟著反應，一般的 <Tex>{'x[n]'}</Tex>{' '}
          實際留在 PD 輸出的是經過 PLL error path 濾波之後的結果（<ChRef ch="06">Ch06</ChRef>），圖上的式子沒有把這個濾波寫進去。下表逐列說明每個符號對應的硬體與注意事項。
        </Fig>
        <div className="table-wrap">
          <table className="ch05-table">
            <thead>
              <tr>
                <th>本章符號</th>
                <th>PLL / DTC 校正中的硬體</th>
                <th>注意</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'s'}</Tex>
                </td>
                <td>
                  DTC 補償的殘差在 PD 輸出留下的時間誤差 <Tex>{'(a-w)\\,x'}</Tex>：feedback edge 早到 <Tex>{'a\\,x'}</Tex>，reference 端 DTC 的補償量是{' '}
                  <Tex>{'w\\,x'}</Tex>（從基準延遲 <Tex>{'T_0'}</Tex> 少延遲這麼多）；補償不足（<Tex>{'w<a'}</Tex>）時為正（經 PLL error path，見 <ChRef ch="06">Ch06</ChRef>）
                </td>
                <td>
                  本章 <Tex>{'x\\equiv1'}</Tex>；一般 <Tex>{'x'}</Tex> 時 <Tex>{'E[q\\,x]'}</Tex> 需對 code 分布平均
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'v,\\sigma_v'}</Tex>
                </td>
                <td>Reference / VCO jitter、DSM 量化殘差、BBPD 本身雜訊，折算到 PD 輸入的時間</td>
                <td>
                  必須是「連續且夠大」才有 <Tex>{'K_q'}</Tex>；時間相關時見章末的延伸（Research 模式）
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\theta'}</Tex>
                </td>
                <td>BBPD offset / setup-hold 不對稱 / metastability 偏向</td>
                <td>
                  offset 不能靠加大 <Tex>{'N'}</Tex> 消除（實驗 preset「offset 蓋過誤差」）
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'q'}</Tex>
                </td>
                <td>
                  1-bit comparator（BBPD／1-bit TDC）取 PD 輸出 <Tex>{'e'}</Tex> 的正負號，輸出位元 <Tex>{'b'}</Tex>，映射 <Tex>{'q=2b-1'}</Tex>
                  （bang-bang PLL 的 PD 本身就是這個 comparator；類比的 PD，例如 SSPD，則是在它的輸出上另外接一個 comparator）
                </td>
                <td>
                  未映射會造成 <Tex>{'\\tfrac12E[x]'}</Tex> 的偏差（T04 反面測試）
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'S_N,\\;G=S_N/N'}</Tex>
                </td>
                <td>
                  GMAC 累加器（<code>REG_GMAC_N</code> 個樣本）；硬體多半輸出 sum，演算法多半寫 average
                </td>
                <td>
                  sum 與 average 差 <Tex>{'N'}</Tex> 倍，learning rate 要跟著換 <Erratum id="E18" />
                </td>
              </tr>
              <tr>
                <td>tie rule</td>
                <td>
                  累加器 MSB 判號（<Tex>{'\\operatorname{sign}(0)=+1'}</Tex>）、零偵測（skip）、LFSR（half）
                </td>
                <td>
                  只取正負號的更新在偶數 <Tex>{'N'}</Tex> 時，確定性 rule 造成 <Tex>{'\\mp1/(NK_q)'}</Tex> 偏差 <Erratum id="E02" />
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'K_q'}</Tex>
                </td>
                <td>
                  Comparator 的等效增益，乘進 LMS loop gain <Tex>{'g=\\mu K_qC'}</Tex>（<ChRef ch="08">Ch08</ChRef>、<ChRef ch="12">Ch12</ChRef>）
                </td>
                <td>
                  <Tex>{'\\sigma_v'}</Tex> 是 PVT 相依的 <Tex>{'\\Rightarrow'}</Tex> loop gain 也跟著漂（<ChRef ch="14">Ch14</ChRef> corner 分析）
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout
          kind="info"
          title={
            <>
              把樣本數換成時間：<Tex>{String.raw`f_s=4\,\mathrm{GHz}`}</Tex> 的 comparator（例如 <Tex>{String.raw`4\,\mathrm{GHz}`}</Tex> reference 的 sub-sampling PLL）
            </>
          }
        >
          <p>
            Comparator 每個 reference 週期判決一次，累加 <Tex>{'N'}</Tex> 個樣本需要 <Tex>{'N/f_s'}</Tex>。以本章的{' '}
            <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex> 為例（<Tex>{'x\\equiv1'}</Tex>、樣本獨立）：
          </p>
          <div className="table-wrap">
            <table className="ch05-table">
              <thead>
                <tr>
                  <th className="num">
                    <Tex>{'N'}</Tex>
                  </th>
                  <th className="num">
                    時間 <Tex>{'N/f_s'}</Tex>
                  </th>
                  <th className="num">
                    精確 <Tex>{'P(\\text{判對})'}</Tex>（half）
                  </th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {v.timeRows.map((r, i) => (
                  <tr key={r.N}>
                    <td className="num">{int(r.N)}</td>
                    <td className="num">
                      <Tex>{`${fx(r.us, 3)}\\,\\mu\\mathrm{s}`}</Tex>
                    </td>
                    <td className="num">{pct(r.pc, 2)}</td>
                    <td>
                      {i === 0 ? (
                        <>
                          一個 GMAC block（T13 的 <Tex>{'N=4096'}</Tex>）：更新率 <Tex>{`f_u=f_s/N=${fx(v.fuKHz, 2)}\\,\\mathrm{kHz}`}</Tex>
                        </>
                      ) : i === 2 ? (
                        '95% 的精確門檻（T05）'
                      ) : i === 3 ? (
                        '99% 的精確門檻'
                      ) : (
                        'Gallery preset #2'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <strong>Regressor 不是 1 的時候：</strong>若要校正的是 {v.phases} 相 PMUX 其中一相的 offset（one-hot regressor，<Tex>{'x\\in\\{0,1\\}'}</Tex>），只有選到那一相的樣本才進累加器；
            各相均勻使用時平均只有 <Tex>{`N/${v.phases}`}</Tex> 個樣本帶有它的資訊，所以同樣的 95% 需要約{' '}
            <Tex>{`${v.phases}\\times${texInt(v.n95)}\\approx${texInt(v.oneHotN)}`}</Tex> 個 comparator 樣本（約{' '}
            <Tex>{`${fx(v.oneHotUs, 1)}\\,\\mu\\mathrm{s}`}</Tex>）。DTC gain 的 regressor 是 DTC residue（大小不一、可能不是零均值），等效樣本數要再乘上 regressor
            的加權，而且 PLL error path 會改變它的相位——這些留到 <ChRef ch="06">Ch06</ChRef>、<ChRef ch="09">Ch09</ChRef>、<ChRef ch="11">Ch11</ChRef>。<ClaimTag kind="approx" /> <SourceTag kind="illustrative" />
          </p>
        </Callout>
        <p>
          <strong>預告：</strong>把本章的平均 <Tex>{'G_k=S_N/N\\approx K_q\\delta_k+\\eta_k'}</Tex> 放進 block 更新{' '}
          <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>（<Tex>{'k'}</Tex> = GMAC block；ChatGPT 課程寫作 <Tex>{'\\alpha'}</Tex>，本站統一寫 <Tex>{'\\mu'}</Tex>，
          單位 fs <Erratum id="E13" />），馬上得到 <ChRef ch="12">Ch12</ChRef> / <ChRef ch="14">Ch14</ChRef> 的設計數字。這裡 <Tex>{'\\delta_k=a-w_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 的剩餘誤差，
          <Tex>{'\\eta_k'}</Tex> 是 <Tex>{'G_k'}</Tex> 扣掉平均後的零均值雜訊，<Tex>{'\\sigma_w'}</Tex> 是收斂之後係數 <Tex>{'w'}</Tex> 還在抖動的 RMS（coefficient noise）。
        </p>
        <Fig name="blockLoop">
          這張圖是{figNo('hwMap')}的線性化版本：「comparator + 位元映射 + GMAC 平均」整段換成藍色的等效增益 <Tex>{'K_q'}</Tex>，加上一個雜訊注入點 <Tex>{'\\eta_k'}</Tex>。先順著迴路繞一圈：
          <Tex>{'\\delta_k'}</Tex> 乘 <Tex>{'K_q'}</Tex>、乘 <Tex>{'\\mu'}</Tex>、進累加器，再以<strong>負號</strong>回到第一個加法點——繞一圈的增益是{' '}
          <Tex>{'g=\\mu K_q'}</Tex>，所以每個 block 誤差剩下 <Tex>{'p_{\\mathrm{cal}}=1-g'}</Tex> 倍。再看雜訊：<Tex>{'\\eta_k'}</Tex> 是平均 <Tex>{'N'}</Tex> 次之後的雜訊，變異數只有約{' '}
          <Tex>{'1/N'}</Tex>，它被迴路濾過之後就是 <Tex>{'\\sigma_w'}</Tex>。圖上的累加器 <Tex>{'1/(z-1)'}</Tex> 是「把輸入一直加起來、下一個 block 才輸出」的簡寫，也就是更新式 <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>；所有的線都是 block 速率（
          <Tex>{'k'}</Tex>）。
        </Fig>
        <Steps
          title={
            <>
              Block Sign-LMS 的 pole 與係數雜訊（<Tex>{'x\\equiv1'}</Tex>，<Tex>{'\\delta=a-w'}</Tex>）
            </>
          }
          steps={[
            { tex: String.raw`\delta_{k+1}=a-w_{k+1}=\delta_k-\mu G_k=\delta_k-\mu\big(K_q\delta_k+\eta_k\big)`, why: <>代入更新式與 <Tex>{'G_k'}</Tex> 的小訊號模型；<Tex>{'\\eta_k'}</Tex> 是 <Tex>{'G_k'}</Tex> 的零均值雜訊。</> },
            { tex: String.raw`=(1-\mu K_q)\,\delta_k-\mu\eta_k,\qquad p_{\mathrm{cal}}\equiv1-g,\;g\equiv\mu K_q`, why: <>整理成一階遞迴；<Tex>{'g'}</Tex> 是無因次 loop gain（<ChRef ch="12">Ch12</ChRef>/<ChRef ch="14">Ch14</ChRef> 把 pole 寫成 <Tex>{'p'}</Tex>）。</> },
            { tex: String.raw`\operatorname{Var}(\eta_k)=\operatorname{Var}(G)=\frac{1-m^2}{N}\approx\frac1N`, why: <>§3 的「平均」變異數（勘誤 E18：不是總和的 <Tex>{'N(1-m^2)'}</Tex>）。</> },
            { tex: String.raw`\sigma_w^2=\frac{\mu^2/N}{1-p_{\mathrm{cal}}^2}\;\Rightarrow\;\sigma_w=\frac{\mu}{\sqrt{N(1-p_{\mathrm{cal}}^2)}}`, why: <>與 §7 相同的穩態變異數推導；需 <Tex>{'|p_{\\mathrm{cal}}|<1\\iff0<\\mu<2/K_q'}</Tex>。</> },
          ]}
        />
        <TexBlock
          id="F-05.20"
          label={
            <>
              Block Sign-LMS 的 pole、時間常數與係數雜訊（<Tex>{'\\delta=a-w'}</Tex>；章末的綜合手算 HC-05.8 就是代這一條）<ClaimTag kind="approx" /> <Erratum id="E18" />
            </>
          }
        >
          {String.raw`\boxed{p_{\mathrm{cal}}=1-\mu K_q,\qquad \tau=\frac{-1}{\ln|p_{\mathrm{cal}}|}\ \text{blocks},\qquad \sigma_w=\frac{\mu}{\sqrt{N\,(1-p_{\mathrm{cal}}^2)}}}\qquad\Big(0<\mu<\mu_{\max}=\frac{2}{K_q}\Big)`}
        </TexBlock>
        <div className="table-wrap">
          <table className="ch05-table">
            <caption>
              <Tex>{String.raw`\sigma_v=100\,\mathrm{fs},\ \mu=10\,\mathrm{fs}`}</Tex>（規格 §12.1 / T13 的設定）。詳細推導與驗證在 <ChRef ch="12">Ch12</ChRef>、<ChRef ch="14">Ch14</ChRef>。
            </caption>
            <tbody>
              <tr>
                <td>
                  穩定範圍 <Tex>{'0<\\mu<2/K_q'}</Tex>
                </td>
                <td className="num">{fx(v.muMax, 2)} fs</td>
              </tr>
              <tr>
                <td>
                  loop gain <Tex>{'g=\\mu K_q'}</Tex>
                </td>
                <td className="num">{fx(v.g, 6)}</td>
              </tr>
              <tr>
                <td>
                  pole <Tex>{'p_{\\mathrm{cal}}=1-\\mu K_q'}</Tex>
                </td>
                <td className="num">{fx(v.p, 5)}</td>
              </tr>
              <tr>
                <td>
                  時間常數 <Tex>{'\\tau=-1/\\ln p_{\\mathrm{cal}}'}</Tex>
                </td>
                <td className="num">{fx(v.tau, 2)} blocks</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\sigma_w'}</Tex>（<Tex>{String.raw`N=10{,}000`}</Tex>）
                </td>
                <td className="num">{fx(v.sw10k, 3)} fs</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\sigma_w'}</Tex>（<Tex>{String.raw`N=4{,}096`}</Tex>，T13）
                </td>
                <td className="num">{fx(v.sw4096, 3)} fs</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="ch05-table">
            <caption>
              <Tex>{'\\mu'}</Tex> 的取捨（<Tex>{String.raw`\sigma_v=100\,\mathrm{fs},\ N=10{,}000`}</Tex>，全部由上式即時計算）：<Tex>{'\\mu'}</Tex> 越大收斂越快、係數雜訊越大；
              <Tex>{'g>1'}</Tex> 時 <Tex>{'p_{\\mathrm{cal}}<0'}</Tex>，誤差會正負交替地衰減。
            </caption>
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'\\mu'}</Tex>（fs）
                </th>
                <th className="num">
                  <Tex>{'g=\\mu K_q'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'p_{\\mathrm{cal}}'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\tau=-1/\\ln|p_{\\mathrm{cal}}|'}</Tex>（blocks）
                </th>
                <th className="num">
                  <Tex>{'\\sigma_w'}</Tex>（fs）
                </th>
              </tr>
            </thead>
            <tbody>
              {v.muRows.map((r) => (
                <tr key={r.mu} className={r.mu === v.mu ? 'ch05-hl' : undefined}>
                  <td className="num">{r.mu}</td>
                  <td className="num">{fx(r.g, 5)}</td>
                  <td className="num">{fx(r.p, 5)}</td>
                  <td className="num">{Number.isFinite(r.tau) ? fx(r.tau, 1) : '—'}</td>
                  <td className="num">{fx(r.sw, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          若硬體的更新晚一個 block 才生效（GMAC 結果要等下一個 block 才寫回），特徵方程變成 <Tex>{'z^2-z+g=0'}</Tex>，穩定範圍從{' '}
          <Tex>{'0<g<2'}</Tex> 縮成 <Tex>{'0<g<1'}</Tex>：本例 <Tex>{`\\mu<1/K_q=${fx(v.muMax / 2, 2)}\\,\\mathrm{fs}`}</Tex>（<ChRef ch="08">Ch08</ChRef> 推導）。
          <ClaimTag kind="exact" />
        </p>
        <p className="ch05-note">
          <ClaimTag kind="approx" /> 線性化模型（<Tex>{'|\\delta|\\ll\\sigma_v'}</Tex>、<Tex>{'\\eta'}</Tex> 近似白雜訊）。sum 模式的 GMAC 要把 <Tex>{'\\mu'}</Tex> 除以{' '}
          <Tex>{'N'}</Tex>，否則 <Tex>{'g'}</Tex> 放大 <Tex>{'N'}</Tex> 倍而發散（<Tex>{'N=4096'}</Tex> 時 <Tex>{`g=${fx(4096 * v.g, 1)}`}</Tex>）。前往{' '}
          <a href="#/ch/12">Ch12 Coefficient Noise</a> 與 <a href="#/ch/14">Ch14 Learning Rate</a>。
        </p>
        <Callout kind="info" title="設計檢查清單（Comparator / GMAC 前端）">
          <ol className="ch05-checklist">
            <li>
              硬體位元 <Tex>{'b'}</Tex> 已映射成 <Tex>{'q=2b-1'}</Tex>（或在 GMAC 端等效處理），且有反面測試。
            </li>
            <li>
              <Tex>{'N'}</Tex> 為奇數，或明確定義 tie rule（random tie-break / 不更新）；MC 與解析用同一條 rule。
            </li>
            <li>GMAC 輸出是 sum 還是 average？learning rate 的單位與 scaling 一致。</li>
            <li>
              量測或估計 <Tex>{'\\sigma_v'}</Tex>（含 PVT），由 <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex> 得到 loop gain 的範圍。
            </li>
            <li>
              Comparator offset <Tex>{'\\theta'}</Tex> 遠小於目標精度，或有 chopping／integral path 吸收。
            </li>
            <li>
              雜訊在 <Tex>{'N'}</Tex> 個樣本內近似獨立；若相關，用 <Tex>{'N_{\\mathrm{eff}}'}</Tex> 而非 <Tex>{'N'}</Tex>（章末延伸，Research 模式）。
            </li>
            <li>
              殘差 <Tex>{'|s|\\lesssim0.25\\sigma_v'}</Tex> 時才用 <Tex>{'K_q'}</Tex>；大誤差階段（coarse）以 slew-limited 估計時間。
            </li>
          </ol>
        </Callout>
      </Section>

      <Section kind="assumptions" level={2} title="注意假設：本章的數字什麼時候不能直接用">
        <p>
          本章標 <ClaimTag kind="exact" /> 的結果，都是在下面這個<strong>指定模型</strong>內精確；標 <ClaimTag kind="approx" /> 的另外用了 CLT 或小訊號展開。
          規格 §5 特別提醒：表中的機率是「辨識<strong>一個固定非零偏移之符號</strong>」的機率，不是完整 LMS 迴路在 <Tex>{'N'}</Tex> 次後收斂的機率。
        </p>
        <div className="table-wrap">
          <table className="ch05-table">
            <thead>
              <tr>
                <th>假設</th>
                <th>用在哪裡</th>
                <th>不成立時會怎樣</th>
                <th>去哪裡看</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'s'}</Tex> 在 <Tex>{'N'}</Tex> 個樣本內固定
                </td>
                <td>
                  <Tex>{'K\\sim\\mathrm{Bin}(N,p)'}</Tex>、所有 <Tex>{'P(\\text{判對})'}</Tex> 表
                </td>
                <td>
                  迴路每個 block 都在改 <Tex>{'w'}</Tex>，<Tex>{'s=a-w'}</Tex> 跟著變：要用 pole、<Tex>{'\\sigma_w'}</Tex> 描述，而不是單一個機率
                </td>
                <td>§9 預告、<ChRef ch="12">Ch12</ChRef>、<ChRef ch="14">Ch14</ChRef></td>
              </tr>
              <tr>
                <td>
                  <Tex>{'v_i'}</Tex> 彼此獨立（iid）
                </td>
                <td>
                  <Tex>{'\\operatorname{Var}(S_N)=N(1-m^2)'}</Tex>、Binomial、binomial MC 引擎
                </td>
                <td>
                  正相關時 <Tex>{'\\operatorname{Var}(S_N)'}</Tex> 變大，等效的獨立樣本數 <Tex>{'N_{\\mathrm{eff}}<N'}</Tex>，表中正確率被高估（相鄰樣本的相關係數{' '}
                  <Tex>{'\\rho=0.99'}</Tex>、<Tex>{'N=4096'}</Tex> 時 <Tex>{`N_{\\mathrm{eff}}\\approx${texInt(v.corr[3].nEff)}`}</Tex>）
                </td>
                <td>章末延伸（Research 模式）、<ChRef ch="12">Ch12</ChRef></td>
              </tr>
              <tr>
                <td>
                  <Tex>{'v'}</Tex> 是 Gaussian
                </td>
                <td>
                  <Tex>{'\\Phi'}</Tex>、<Tex>{'\\operatorname{erf}'}</Tex>、<Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>
                </td>
                <td>
                  一般雜訊 PDF <Tex>{'f_v'}</Tex> 下 <Tex>{'K_q=2f_v(0)'}</Tex>；S 曲線形狀不同，應以量測的斜率取代
                </td>
                <td>§5（Research 註）</td>
              </tr>
              <tr>
                <td>
                  Comparator offset <Tex>{'\\theta=0'}</Tex>
                </td>
                <td>
                  「<Tex>{'E[q]'}</Tex> 與 <Tex>{'s'}</Tex> 同號」
                </td>
                <td>
                  <Tex>{'E[q]'}</Tex> 的正負號由 <Tex>{'s-\\theta'}</Tex> 決定；<Tex>{'|\\theta|>|s|'}</Tex> 且同號時，<Tex>{'N'}</Tex> 越大越確定判錯
                </td>
                <td>§6 preset「offset 蓋過誤差」、<ChRef ch="11">Ch11</ChRef></td>
              </tr>
              <tr>
                <td>
                  Regressor <Tex>{'x\\equiv1'}</Tex>
                </td>
                <td>
                  <Tex>{'S_N=\\sum q_i'}</Tex>、<Tex>{'s=a-w'}</Tex>
                </td>
                <td>
                  真實的 GMAC 是 <Tex>{'\\sum q_ix_i'}</Tex>：增益多一個相關量 <Tex>{'C'}</Tex>（<Tex>{'K=K_qC'}</Tex>），PLL error path 的相位還可能讓它變號
                </td>
                <td><ChRef ch="06">Ch06</ChRef>–<ChRef ch="08">Ch08</ChRef></td>
              </tr>
              <tr>
                <td>
                  小訊號 <Tex>{'|s-\\theta|\\ll\\sigma_v'}</Tex>
                </td>
                <td>
                  <Tex>{'E[q]\\approx K_qs'}</Tex>、<Tex>{'N\\approx(z\\sigma_v/s)^2\\pi/2'}</Tex>
                </td>
                <td>
                  S 曲線飽和：線性化高估（<Tex>{'|r|=0.25'}</Tex> 約 1%、<Tex>{'|r|=0.55'}</Tex> 約 5%），更新變成 slew-limited
                </td>
                <td>§5、§6 preset「飽和」</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'N'}</Tex> 夠大（CLT）
                </td>
                <td>
                  <Tex>{'\\Phi(m\\sqrt N/\\sqrt{1-m^2})'}</Tex>
                </td>
                <td>
                  誤差 <Tex>{'O(1/\\sqrt N)'}</Tex>；偶數 <Tex>{'N'}</Tex> 時它其實是 tie 平分的值，照字面的 <Tex>{'P(S_N>0)'}</Tex> 會差到{' '}
                  {fx(100 * (v.half100 - v.strict100), 1)} 個百分點（<Tex>{'N=100'}</Tex>）<Erratum id="E02" />
                </td>
                <td>§3.2–§3.3</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section kind="example" level={2} title="綜合手算：把本章的公式串成一次迴路設計">
        <p>
          前面每一節都有一題「帶入手算」。最後這一題把它們串起來，走一次實際的設計流程：由量到的 <Tex>{'\\sigma_v'}</Tex> 得到{' '}
          <Tex>{'K_q'}</Tex>（§5）→ 學習率 <Tex>{'\\mu'}</Tex> 最大能用多少（<Tex>{'\\mu_{\\max}=2/K_q'}</Tex>）→ 收斂要多久（pole、<Tex>{'\\tau'}</Tex>，再用{' '}
          <Tex>{'N/f_s'}</Tex> 換成時間）→ 收斂後係數還會抖多少（<Tex>{'\\sigma_w'}</Tex>，用到 §3 的 <Tex>{'\\operatorname{Var}(G)\\approx1/N'}</Tex>）。預設數字是 §9
          表格與 T13 的設定（<Tex>{String.raw`\sigma_v=100\,\mathrm{fs},\ \mu=10\,\mathrm{fs},\ N=4096`}</Tex>），取樣率用前面的{' '}
          <Tex>{String.raw`f_s=4\,\mathrm{GHz}`}</Tex>。
        </p>
        <Fig name="handcalcFlow">
          照編號 ①→⑧ 一格一格算：先由 <Tex>{'\\sigma_v'}</Tex> 得到 <Tex>{'K_q'}</Tex>（①），它同時決定學習率的上限 <Tex>{'\\mu_{\\max}'}</Tex>（②）與 loop gain{' '}
          <Tex>{'g'}</Tex>（③）；由 <Tex>{'g'}</Tex> 得到 pole（④）與以 block 為單位的時間常數 <Tex>{'\\tau'}</Tex>（⑤）；另一邊由 <Tex>{'N'}</Tex> 與取樣率 <Tex>{'f_s'}</Tex>{' '}
          得到一個 block 的時間 <Tex>{'T_{\\mathrm{blk}}'}</Tex>（⑥），兩者相乘就是換成秒的時間常數 <Tex>{'t_\\tau'}</Tex>（⑦）；最後 <Tex>{'\\mu'}</Tex>、<Tex>{'N'}</Tex>{' '}
          與 pole 一起給出係數雜訊 <Tex>{'\\sigma_w'}</Tex>（⑧）。圖上的每一格對應下面手算題的一到兩個步驟，③④⑧ 合起來就是 F-05.20。
        </Fig>
        <HandCalcBlock id="HC-05.8">
          把四個數字換成你自己的設計（<Tex>{'\\sigma_v'}</Tex>、<Tex>{'\\mu'}</Tex>、<Tex>{'N'}</Tex>、<Tex>{'f_s'}</Tex>），先用紙筆和計算機一路算到{' '}
          <Tex>{'\\sigma_w'}</Tex>，再對答案。算完後試試把 <Tex>{'\\mu'}</Tex> 加倍：收斂時間與 <Tex>{'\\sigma_w'}</Tex> 各變成幾倍？
        </HandCalcBlock>
      </Section>

      <Section kind="example" level={2} title="思考題">
        <Quiz
          title="思考題 1"
          question={
            <>
              <Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex> 不變，誤差從 <Tex>{String.raw`1\,\mathrm{fs}`}</Tex> 變成 <Tex>{'s=2\\,\\mathrm{fs}'}</Tex>。要讓方向判斷達到
              95%，大約需要多少樣本？
            </>
          }
          options={[{ label: '約 42,500' }, { label: '約 21,250' }, { label: '約 10,600', correct: true }, { label: '約 170,000' }]}
          answer={
            <>
              <Tex>{'N\\approx(z\\sigma_v/s)^2\\pi/2\\propto1/s^2'}</Tex>：<Tex>{'s'}</Tex> 加倍，<Tex>{'N'}</Tex> 變 <Tex>{'1/4'}</Tex>。CLT 連續解{' '}
              {fx(v.n95s2clt, 1)}，精確最小奇數 <Tex>{`N=${v.n95s2 === null ? '\\text{—}' : texInt(v.n95s2)}`}</Tex>。
            </>
          }
        />
        <Quiz
          title="思考題 2"
          question={
            <>
              <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs},\ N=100`}</Tex>。硬體直接拿 GMAC 累加器的 MSB 當正負號（0 視為正，也就是{' '}
              <Tex>{'\\operatorname{sign}(0)=+1'}</Tex>）。方向判對的機率是？
            </>
          }
          options={[{ label: pct(v.strict100, 1) }, { label: pct(v.half100, 1) }, { label: pct(v.plus100, 1), correct: true }, { label: '50.0%' }]}
          answer={
            <>
              偶數 <Tex>{'N'}</Tex> 有 <Tex>{`P(S_N=0)=${texPct(v.tie100, 2)}`}</Tex>。<Tex>{'\\operatorname{sign}(0)=+1'}</Tex> 把 tie 全部判成 <Tex>{'+1'}</Tex>，而{' '}
              <Tex>{'s>0'}</Tex> 時 <Tex>{'+1'}</Tex> 正好是對的：<Tex>{`P(S_N\\ge0)=${texPct(v.plus100, 2)}`}</Tex>。{pct(v.half100, 1)} 是 random tie-break（規格 CLT
              表），{pct(v.strict100, 1)} 是嚴格的 <Tex>{'P(S_N>0)'}</Tex>。但注意：這個「好處」在 <Tex>{'s<0'}</Tex> 時變成壞處；若迴路只取正負號更新，還會在收斂點造成約{' '}
              <Tex>{`${fx(v.eqPlus100, 2)}\\,\\mathrm{fs}`}</Tex> 的偏差（§3.4，Engineer 模式顯示推導）。
              <Erratum id="E02" />
            </>
          }
        />
        <Quiz
          title="思考題 3（計算）"
          question={
            <>
              BBPD 雜訊從 <Tex>{String.raw`100\,\mathrm{fs}`}</Tex> 變成 <Tex>{String.raw`200\,\mathrm{fs}`}</Tex>（例如換了較差的 reference）。<Tex>{'K_q'}</Tex> 變多少？辨識 <Tex>{String.raw`1\,\mathrm{fs}`}</Tex> 誤差達 95% 需要的 <Tex>{'N'}</Tex> 變多少？
            </>
          }
          answer={
            <>
              <Tex>{`K_q=\\sqrt{2/\\pi}/200=${fx(v.K200, 6)}\\,\\mathrm{fs}^{-1}`}</Tex>（減半）。<Tex>{'N\\propto\\sigma_v^2'}</Tex>：約變 4 倍，精確最小奇數{' '}
              <Tex>{`N=${v.n95sig200 === null ? '\\text{—}' : texInt(v.n95sig200)}`}</Tex>。LMS 的 loop gain <Tex>{'g=\\mu K_qC'}</Tex> 也減半——若 <Tex>{'\\mu'}</Tex>{' '}
              不跟著調整，收斂時間 <Tex>{'\\tau\\approx1/g'}</Tex> 約加倍（<ChRef ch="14">Ch14</ChRef>）。
            </>
          }
        />
        <Quiz
          title="思考題 4"
          question={
            <>
              同樣用 random tie-break，<Tex>{'N=1000'}</Tex> 與 <Tex>{'N=999'}</Tex> 哪一個判對機率高？
            </>
          }
          options={[
            {
              label: (
                <>
                  <Tex>{'N=1000'}</Tex>，多一個樣本總是比較好
                </>
              ),
            },
            { label: '一樣高', correct: true },
            { label: <Tex>{'N=999'}</Tex> },
          ]}
          answer={
            <>
              精確恆等式 <Tex>{'P(S_N>0)+\\tfrac12P(S_N=0)=P(S_{N-1}>0)'}</Tex>（證明在 §3.5，Research 模式顯示）：偶數 <Tex>{'N'}</Tex> 的最後一個樣本只會把 <Tex>{'S_{N-1}=\\pm1'}</Tex> 推成 <Tex>{'0'}</Tex> 或 <Tex>{'\\pm2'}</Tex>，平分 tie 之後剛好打平。
              <ClaimTag kind="exact" />
            </>
          }
        />
        <Quiz
          title="思考題 5"
          question={
            <>
              Comparator 輸出 0/1 位元 <Tex>{'b'}</Tex>，工程師忘了映射，直接把 <Tex>{'b'}</Tex> 累加。當 <Tex>{'s=0'}</Tex>（已經校正好）時，<Tex>{'E[b]'}</Tex>{' '}
              是多少？會發生什麼事？
            </>
          }
          answer={
            <>
              <Tex>{'E[b]=P(q=+1)=\\Phi(0)=0.5'}</Tex>，不是 0。GMAC 在真值處仍有平均輸出 <Tex>{'\\tfrac12E[x]'}</Tex>，若 code 有直流成分，迴路會偏到別的固定點（golden T04
              例子：在真值的平均更新 <Tex>{`${fx(v.wrongUpdate, 3)}`}</Tex>、固定點偏 <Tex>{`${fx(v.wrongShift, 2)}\\,\\mathrm{fs}`}</Tex>）；零均值 code 則只是增益減半，很難從波形看出來。
            </>
          }
        />
      </Section>

      <Recap
        title="本課必記"
        formulas={[
          { tex: String.raw`\boxed{P(q=+1)=\Phi\!\left(\frac{s-\theta}{\sigma_v}\right),\qquad m=E[q]=\operatorname{erf}\!\left(\frac{s-\theta}{\sqrt2\,\sigma_v}\right)}`, label: '單一樣本（精確）' },
          { tex: String.raw`\boxed{E[S_N]=Nm,\quad\operatorname{Var}(S_N)=N(1-m^2),\quad G=S_N/N}`, label: (
              <>
                總和 <Tex>{'S_N'}</Tex>（勘誤 E07/E18）
              </>
            ),
          },
          { tex: String.raw`\boxed{P(\text{判對})\approx\Phi\!\left(\frac{m\sqrt N}{\sqrt{1-m^2}}\right)\quad(\text{奇數 }N\text{ 或 random tie-break})}`, label: 'CLT（勘誤 E02）' },
          { tex: String.raw`\boxed{N\approx\left(\frac{z\,\sigma_v}{s}\right)^2\frac\pi2}`, label: '所需樣本數' },
          { tex: String.raw`\boxed{K_q=\sqrt{\frac2\pi}\,\frac1{\sigma_v}\quad(|s|\ll\sigma_v)}`, label: '小訊號統計增益' },
        ]}
        points={[
          <>
            1-bit 沒有丟掉小誤差的資訊，只是把它變成 <Tex>{'m\\approx K_qs'}</Tex> 的機率偏差；訊號 <Tex>{'\\propto N'}</Tex>、雜訊 <Tex>{'\\propto\\sqrt N'}</Tex>。
          </>,
          <>
            偶數 <Tex>{'N'}</Tex> 有 tie：規格 <Tex>{'N=100'}</Tex> 的 {pct(v.half100, 1)} 只對 random tie-break 成立；strict 只有 {pct(v.strict100, 1)}、
            <Tex>{'\\operatorname{sign}(0)=+1'}</Tex> 是 {pct(v.plus100, 1)}。用奇數 <Tex>{'N'}</Tex> 最乾淨。
          </>,
          <>
            所需樣本 <Tex>{'\\propto(\\sigma_v/s)^2'}</Tex>，1-bit 比類比多付 <Tex>{'\\pi/2'}</Tex> 倍（約 <Tex>{String.raw`2\,\mathrm{dB}`}</Tex>）。
          </>,
          <>
            <Tex>{'K_q'}</Tex> 只在 <Tex>{'|s|\\lesssim0.25\\,\\sigma_v'}</Tex> 時準（高估 &lt; 1%）；大誤差時 S 曲線飽和、更新變成 slew-limited。
          </>,
          <>
            雜訊像 dither：沒有雜訊會 limit cycle、有偏；太多雜訊 <Tex>{'K_q'}</Tex> 太小、又慢又吵；offset <Tex>{'\\theta'}</Tex> 則任何雜訊都救不了。
          </>,
        ]}
      />

      <ModeGate min="research">
        <Section kind="assumptions" level={2} title="延伸（Research）：雜訊有時間相關時">
          <p>
            本章所有結果都假設 <Tex>{'v_i'}</Tex> 獨立。若 <Tex>{'v'}</Tex> 是 AR(1) Gaussian（相鄰相關係數 <Tex>{'\\rho'}</Tex>，例如 low-pass 過的 reference
            雜訊），在 <Tex>{'s=\\theta'}</Tex>（<Tex>{'m=0'}</Tex>）時有精確的 arcsine law（Van Vleck）：兩個 clipped Gaussian 的相關是{' '}
            <Tex>{'\\frac2\\pi\\arcsin\\rho'}</Tex>。
          </p>
          <Prereq title="相關係數與 AR(1) 雜訊">
            <p>
              兩個零均值、變異數 1 的隨機變數 <Tex>{'X,Y'}</Tex> 的<strong>相關係數</strong> <Tex>{'\\rho=E[XY]'}</Tex>（一般情形 <Tex>{'\\rho=\\operatorname{Cov}(X,Y)/(\\sigma_X\\sigma_Y)'}</Tex>）
              量測「一起變大、一起變小」的程度：<Tex>{'\\rho=1'}</Tex> 完全同步、<Tex>{'0'}</Tex> 無關（Gaussian 時等於獨立）、<Tex>{'-1'}</Tex> 完全相反。
            </p>
            <p>
              <strong>AR(1)</strong>：<Tex>{'v_{i+1}=\\rho\\,v_i+\\sqrt{1-\\rho^2}\\,z_i'}</Tex>，<Tex>{'z_i'}</Tex> iid 標準常態。代入可得{' '}
              <Tex>{'E[v_iv_{i+k}]=\\rho^k'}</Tex>：相關隨間隔 <Tex>{'k'}</Tex> 呈等比衰減，係數 <Tex>{'\\sqrt{1-\\rho^2}'}</Tex> 讓每個 <Tex>{'v_i'}</Tex>{' '}
              的變異數都保持 1。
            </p>
          </Prereq>
          <Fig name="ar1">
            先看 <Tex>{'\\times\\rho'}</Tex> 的回授迴圈：新的雜訊樣本 <Tex>{'v_{i+1}'}</Tex> 有 <Tex>{'\\rho'}</Tex> 倍來自上一個樣本 <Tex>{'v_i'}</Tex>，其餘來自新的白雜訊 <Tex>{'z_i'}</Tex>，所以相鄰的{' '}
            <Tex>{'v'}</Tex> 很像。再看 sign 之後：相鄰的 <Tex>{'q'}</Tex> 也跟著相似（相關係數 <Tex>{'\\tfrac2\\pi\\arcsin\\rho'}</Tex>，下面推導），累加時雜訊不再互相抵消得那麼乾淨，
            <Tex>{'\\operatorname{Var}(S_N)'}</Tex> 比獨立時的 <Tex>{'N'}</Tex> 大，等效的獨立樣本數 <Tex>{'N_{\\mathrm{eff}}'}</Tex> 就比 <Tex>{'N'}</Tex> 小。圖上的{' '}
            <Tex>{'\\times\\rho'}</Tex> 與 <Tex>{'\\times\\sqrt{1-\\rho^2}'}</Tex> 就是先備知識框裡 AR(1) 式子的兩個係數。
          </Fig>
          <Steps
            title={
              <>
                Arcsine law：<Tex>{String.raw`E[\operatorname{sign}X\,\operatorname{sign}Y]=\tfrac2\pi\arcsin\rho`}</Tex>
              </>
            }
            steps={[
              { tex: String.raw`Y=\rho X+\sqrt{1-\rho^2}\,Z,\qquad X,Z\ \text{獨立}\sim\mathcal N(0,1)`, why: <>任何相關係數 <Tex>{'\\rho'}</Tex> 的標準 Gaussian 對都能這樣寫（AR(1) 的一步）。</> },
              { tex: String.raw`(X,Z)=(R\cos\beta,\,R\sin\beta),\quad \beta\sim\mathrm{Uniform}[0,2\pi)`, why: <>兩個獨立標準常態的聯合 PDF <Tex>{'\\frac1{2\\pi}e^{-(x^2+z^2)/2}'}</Tex> 只和半徑有關，所以角度均勻分布。</> },
              { tex: String.raw`Y=R\big(\sin\psi\cos\beta+\cos\psi\sin\beta\big)=R\sin(\beta+\psi),\quad \sin\psi\equiv\rho`, why: <>令 <Tex>{'\\rho=\\sin\\psi'}</Tex>（<Tex>{'\\psi=\\arcsin\\rho\\in[-\\tfrac\\pi2,\\tfrac\\pi2]'}</Tex>），則 <Tex>{'\\sqrt{1-\\rho^2}=\\cos\\psi'}</Tex>；再用和角公式 <Tex>{'\\sin(\\beta+\\psi)=\\sin\\beta\\cos\\psi+\\cos\\beta\\sin\\psi'}</Tex>。</> },
              { tex: String.raw`X>0\iff\cos\beta>0,\qquad Y>0\iff\sin(\beta+\psi)>0`, why: <><Tex>{'R>0'}</Tex>，正負只看角度。</> },
              { tex: String.raw`P(\operatorname{sign}X\ne\operatorname{sign}Y)=\frac{2\,(\pi/2-\psi)}{2\pi}=\frac12-\frac{\psi}{\pi}`, why: <>兩個半平面的邊界相差角度 <Tex>{'\\pi/2-\\psi'}</Tex>；異號的扇形共兩塊，再除以總角度 <Tex>{'2\\pi'}</Tex>。</> },
              { tex: String.raw`E[\operatorname{sign}X\operatorname{sign}Y]=1-2P(\text{異號})=\frac{2\psi}{\pi}=\frac2\pi\arcsin\rho`, why: <>同號得 <Tex>{'+1'}</Tex>、異號得 <Tex>{'-1'}</Tex>：<Tex>{'E=(1-P_{\\ne})-P_{\\ne}'}</Tex>。</> },
              { tex: String.raw`\operatorname{Var}(S_N)=\sum_{i,j}E[q_iq_j]=N+2\sum_{k=1}^{N-1}(N-k)\,\frac2\pi\arcsin(\rho^k)`, why: <><Tex>{'m=0'}</Tex> 時 <Tex>{'\\operatorname{Var}(S_N)=E[S_N^2]'}</Tex>；對角線 <Tex>{'N'}</Tex> 項各為 1，間隔 <Tex>{'k'}</Tex> 的配對有 <Tex>{'2(N-k)'}</Tex> 個，相關係數 <Tex>{'\\rho^k'}</Tex>。</> },
            ]}
          />
          <TexBlock
            id="F-05.17"
            label={
              <>
                相關雜訊下的 <Tex>{'\\operatorname{Var}(S_N)'}</Tex> <ClaimTag kind="exact" />（<Tex>{'s=\\theta'}</Tex>；<Tex>{'s\\ne\\theta'}</Tex> 但很小時為近似）
              </>
            }
          >
            {String.raw`\operatorname{Var}(S_N)=N+2\sum_{k=1}^{N-1}(N-k)\,\frac2\pi\arcsin(\rho^k),\qquad N_{\mathrm{eff}}=\frac{N^2}{\operatorname{Var}(S_N)}`}
          </TexBlock>
          <div className="table-wrap">
            <table className="ch05-table">
              <caption>
                <Tex>{'N=4096'}</Tex>。<Tex>{'N_{\\mathrm{eff}}'}</Tex> 是「等效的獨立樣本數」：<Tex>{'\\mathrm{SNR}\\approx m\\sqrt{N_{\\mathrm{eff}}}'}</Tex>。單元測試以 AR(1)
                Monte Carlo 驗證此式（<Tex>{'\\rho=0.9,\\ N=64'}</Tex>，誤差 &lt; 5%）。
              </caption>
              <thead>
                <tr>
                  <th className="num">
                    <Tex>{'\\rho'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'\\operatorname{Var}(S_N)/N'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'N_{\\mathrm{eff}}'}</Tex>
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.corr.map((r) => (
                  <tr key={r.rho}>
                    <td className="num">{r.rho}</td>
                    <td className="num">{fx(r.varSum / 4096, 3)}</td>
                    <td className="num">{int(r.nEff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <Tex>{'\\rho=0.99'}</Tex> 時 4096 個樣本只相當於約 {int(v.corr[3].nEff)} 個獨立樣本——本章的 <Tex>{'N'}</Tex> 表格會嚴重高估正確率。此時 binomial MC
            引擎不再適用（必須 sample-level），<Tex>{'K_q'}</Tex> 本身（單一樣本的平均斜率，只看邊際分布）不受影響，但 GMAC 雜訊 <Tex>{'\\eta'}</Tex>{' '}
            變成有色雜訊（規格附錄 C R1）。<ClaimTag kind="research" />
          </p>
          <p>
            <strong>下一個值得研究的問題：</strong>非 Gaussian 雜訊（含 deterministic jitter）的 S 曲線量測與 <Tex>{'K_q'}</Tex> 估計；BBPD metastability
            視窗造成的「軟 tie」；以及 comparator offset 的線上估計（chopping 或 dual-threshold）。<ClaimTag kind="research" />
          </p>
        </Section>
      </ModeGate>
    </>
  )
}
