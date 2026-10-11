import { Callout, ClaimTag, CodeBlock, CodeCompare, Prereq, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import { calLoop, REGIME_LABEL } from '@/simulation/models/calNoise'
import { refValues, T13_SETUP } from '../../refValues'
import { regimeLabelTex, texHz, texNum, texPct } from '../../format'
import { Collapsible, ErratumTag, FormulaLinks, Gate, PageLinks, Rich } from '../../common'
import { Topic } from './Topic'

/**
 * 2.5 PSD 正規化；2.6 頻寬的四個數；2.7 Multirate。
 * 數字由 refValues() 與 calLoop（第 12 章的核心）計算。
 */
export function PsdTopic() {
  const r = refValues()
  const q = r.psd
  return (
    <Topic id="psd" no="2.5" title="PSD 正規化：DTFT 形式、單邊 per-Hz 與 $\mathcal L(f)$">
      <p>
        <strong>一個問題：</strong>兩個人算同一個係數雜訊的 PSD，一個得到 <Tex>{String.raw`${texNum(q.swDtftDc)}`}</Tex>，另一個得到{' '}
        <Tex>{String.raw`${texNum(q.sw1Dc)}`}</Tex>，差了 <Tex>{String.raw`${texNum(q.dbErrBlock, 3)}\,\mathrm{dB}`}</Tex>。兩個都沒算錯——他們用的是兩種不同的正規化（<ErratumTag eid="E28" />
        ）。PSD 的數字只有在說清楚「對什麼積分會得到變異數」之後才有意義。
      </p>
      <Prereq title="功率頻譜密度（PSD）：變異數在頻率上怎麼分布">
        <p>
          一個零平均的隨機序列 <Tex>{'y'}</Tex> 的「功率」就是它的變異數 <Tex>{String.raw`\sigma_y^2=E[y^2]`}</Tex>。PSD 回答的是：這些功率有多少落在慢的變化（低頻）、多少落在快的變化（高頻）。
          它是一個「密度」：<strong>要對頻率積分才得到功率</strong>，就像線密度（kg/m）要對長度積分才得到質量。所以 PSD 的單位永遠是「<Tex>{'y'}</Tex> 的單位平方 ÷ 頻率的單位」，
          而頻率的單位可以選 Hz，也可以選 rad/sample——這就是兩種正規化的來源。
        </p>
      </Prereq>
      <TexBlock>{String.raw`\underbrace{\sigma^2=\frac{1}{2\pi}\int_{-\pi}^{\pi}S(e^{j\Omega})\,d\Omega}_{\text{DTFT 形式（雙邊，對 }\Omega\text{ 積分）}}\qquad\qquad\underbrace{\sigma^2=\int_{0}^{f_r/2}S^{(1)}(f)\,df}_{\text{單邊 per-Hz（對 }f\text{ 積分）}}`}</TexBlock>
      <StepDerivation
        title={
          <>
            一步一步：兩種形式的換算（<Tex>{'f_r'}</Tex> 是這個序列自己的取樣率）
          </>
        }
        steps={[
          { tex: String.raw`\sigma^2=\frac{1}{2\pi}\int_{-\pi}^{\pi}S(e^{j\Omega})\,d\Omega`, why: '從 DTFT 形式的定義出發（理論推導最常用的寫法）。' },
          {
            tex: String.raw`\Omega=\frac{2\pi f}{f_r}\ \Rightarrow\ d\Omega=\frac{2\pi}{f_r}\,df,\qquad \Omega=\pm\pi\leftrightarrow f=\pm\frac{f_r}{2}`,
            why: <>變數代換：把「每個樣本轉幾 rad」換成「每秒幾個週期」。</>,
          },
          { tex: String.raw`\sigma^2=\frac{1}{2\pi}\int_{-f_r/2}^{f_r/2}S\,\frac{2\pi}{f_r}\,df=\frac{1}{f_r}\int_{-f_r/2}^{f_r/2}S\big(e^{j2\pi f/f_r}\big)\,df`, why: <>代入並約掉 <Tex>{String.raw`2\pi`}</Tex>。</> },
          {
            tex: String.raw`=\frac{2}{f_r}\int_{0}^{f_r/2}S\big(e^{j2\pi f/f_r}\big)\,df`,
            why: <>實數序列的 PSD 是偶函數（<Tex>{String.raw`S(e^{-j\Omega})=S(e^{j\Omega})`}</Tex>）：負頻率那一半折到正頻率，所以乘 2。</>,
          },
          {
            tex: String.raw`\Rightarrow\ S^{(1)}(f)=\frac{2}{f_r}\,S\big(e^{j2\pi f/f_r}\big),\qquad 0<f<\frac{f_r}{2}`,
            why: '與單邊 per-Hz 的定義逐項比較。',
          },
        ]}
        result={String.raw`S^{(1)}(f)=\frac{2}{f_r}\,S\big(e^{j2\pi f/f_r}\big)\qquad\Big(\text{block 量：}f_r=f_u;\quad\text{sample 量：}f_r=f_s\Big)`}
      />
      <div className="table-wrap">
        <table className="fr-table fr-psd-table">
          <thead>
            <tr>
              <th>先算一次（T13 條件）</th>
              <th>DTFT 形式</th>
              <th>單邊 per-Hz</th>
              <th>驗算</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label="例">
                白色 GMAC 雜訊 <Tex>{String.raw`\eta_k`}</Tex>（<Tex>{String.raw`\sigma_\eta^2=1/N`}</Tex>，速率 <Tex>{'f_u'}</Tex>）
              </td>
              <td data-label="DTFT">
                <Tex>{String.raw`S_\eta=\sigma_\eta^2=${texNum(1 / T13_SETUP.N)}`}</Tex>（平的）
              </td>
              <td data-label="per-Hz">
                <Tex>{String.raw`\frac{2\sigma_\eta^2}{f_u}=${texNum(q.whiteEta1)}\ \mathrm{Hz^{-1}}`}</Tex>
              </td>
              <td data-label="驗算">
                <Tex>{String.raw`\times\frac{f_u}{2}=${texNum(q.whiteEta1 * (r.loop.fu / 2))}=\sigma_\eta^2`}</Tex> ✓
              </td>
            </tr>
            <tr>
              <td data-label="例">
                係數雜訊在 DC：<Tex>{String.raw`S_w(1)=\frac{\mu^2\sigma_\eta^2}{(1-p)^2}`}</Tex>
              </td>
              <td data-label="DTFT">
                <Tex>{String.raw`${texNum(q.swDtftDc)}\ \mathrm{fs^2}`}</Tex>（對 <Tex>{String.raw`\Omega/2\pi`}</Tex> 積分，即每 cycle/block）
              </td>
              <td data-label="per-Hz">
                <Tex>{String.raw`S_w^{(1)}(0)=${texNum(q.sw1Dc)}\ \mathrm{fs^2/Hz}`}</Tex>
              </td>
              <td data-label="驗算">
                <Tex>{String.raw`\times\mathrm{ENBW}=${texNum(q.sw1Dc * r.loop.enbw, 5)}\,\mathrm{fs^2}=\sigma_w^2`}</Tex> ✓（§2.6）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout kind="warn" title="忘了乘 $2/f_r$ 會差多少？">
        <p>
          把 DTFT 形式的數字直接當成 per-Hz 用，位準會偏 <Tex>{String.raw`10\log_{10}(f_r/2)`}</Tex>：block-rate（<Tex>{'f_u'}</Tex>）是{' '}
          <Tex>{String.raw`${texNum(q.dbErrBlock, 3)}\,\mathrm{dB}`}</Tex>，sample-rate（<Tex>{String.raw`f_s=4\,\mathrm{GHz}`}</Tex>）是 <Tex>{String.raw`${texNum(q.dbErrSample, 3)}\,\mathrm{dB}`}</Tex>。
          這種誤差大到不可能看不出來，但在串接「§12.2 的離散卷積 → §12.3 的 <Tex>{String.raw`\mathcal L(f)`}</Tex>」時很容易漏掉。
        </p>
      </Callout>
      <h4 className="fr-sub">
        從時間誤差的 PSD 到 <Tex>{String.raw`\mathcal L(f)`}</Tex>
      </h4>
      <StepDerivation
        steps={[
          {
            tex: String.raw`S_\phi^{(1)}(f)=(2\pi f_{\mathrm{out}})^2\,S_t^{(1)}(f)`,
            why: (
              <>
                相位 = <Tex>{String.raw`2\pi f_{\mathrm{out}}`}</Tex> × 時間（§2.2）；PSD 是「平方量」，所以倍率要平方。單位：<Tex>{String.raw`\mathrm{rad^2/Hz}`}</Tex>。
              </>
            ),
          },
          {
            tex: String.raw`\mathcal L(f)=10\log_{10}\frac{S_\phi^{(1)}(f)}{2}\quad[\mathrm{dBc/Hz}]`,
            why: (
              <>
                單邊 PSD 把載波兩側（<Tex>{String.raw`f_{\mathrm{out}}\pm f`}</Tex>）的功率合在一起算；<Tex>{String.raw`\mathcal L(f)`}</Tex> 只算其中一側（single sideband），所以除以 2（−3.01 dB）。
              </>
            ),
          },
          {
            tex: String.raw`S_t^{(1)}=${texNum(q.exampleSt)}\,\mathrm{fs^2/Hz}\ \Rightarrow\ S_\phi^{(1)}=${texNum(q.exampleSphi)}\,\mathrm{rad^2/Hz}\ \Rightarrow\ \mathcal L=${texNum(q.exampleL, 5)}\ \mathrm{dBc/Hz}`,
            why: (
              <>
                示例數字（<Tex>{String.raw`f_{\mathrm{out}}=13\,\mathrm{GHz}`}</Tex>；不是量測）：注意先把 fs² 換成 s² 或直接用 <Tex>{String.raw`\mathrm{rad/fs}`}</Tex> 的換算因子。
              </>
            ),
          },
        ]}
      />
      <Callout kind="info" title="每一張 PSD 圖都要標的五件事">
        <ol className="fr-compact">
          <li>one-sided 還是 two-sided（本站預設 one-sided）。</li>
          <li>
            頻率軸屬於哪個取樣率：<Tex>{'f_s'}</Tex>（sample）還是 <Tex>{'f_u'}</Tex>（block）。
          </li>
          <li>
            縱軸單位：<Tex>{String.raw`\mathrm{fs^2/Hz}`}</Tex>、<Tex>{String.raw`\mathrm{rad^2/Hz}`}</Tex> 或 <Tex>{String.raw`\mathrm{dBc/Hz}`}</Tex>。
          </li>
          <li>估計方法：window、segment 長度與重疊（Welch）。</li>
          <li>
            window 的 ENBW（以 bin 或 Hz 計）——這是「頻譜估計器」的等效雜訊頻寬，和 §2.6 迴路濾波器的 ENBW 是兩回事，只是同名。
          </li>
        </ol>
      </Callout>
      <Collapsible title="核心程式碼：block-rate PSD 的兩種形式（calNoise.ts）">
        <CodeBlock
          source={calNoiseSrc}
          region="swPsd"
          path="src/simulation/models/calNoise.ts"
          caption="swDtft 是 DTFT 形式；swOneSided 只多乘一個 $2/f_u$。第 12 章所有 PSD 圖都由這兩個函式產生。"
        />
      </Collapsible>
      <div className="fr-topic-foot small">
        <ClaimTag kind="exact" /> <SourceTag kind="illustrative" /> <PageLinks ids={['ch12', 'ch13']} /> <FormulaLinks ids={['F-12.10', 'F-12.16']} />
      </div>
    </Topic>
  )
}

export function BandwidthTopic() {
  const r = refValues()
  const lp = r.loop
  const eps = 1 - lp.p
  const errOneMinusP = lp.f3dbOneMinusP / lp.f3dbExact - 1
  const errNegLnP = lp.f3dbNegLnP / lp.f3dbExact - 1
  // E27 的四種型態：同一組 N、σ_v、C，只改 g = μK
  const K = lp.K
  const regimes = [lp.g, 0.5, 0.9, 1, 1.5, 2.1].map((g) => ({ g, loop: calLoop({ ...T13_SETUP, mu: g / K }) }))
  return (
    <Topic id="bw" no="2.6" title="頻寬的四個數：exact −3 dB、$-\ln p$、$(1-p)$、ENBW">
      <p>
        <strong>一個問題：</strong>規格 §12.1 寫「校正 Noise BW 約 12.9 kHz」。同一個迴路（<Tex>{String.raw`p=${texNum(lp.p, 5)}`}</Tex>、<Tex>{String.raw`f_u=${texHz(lp.fu, 6)}`}</Tex>）其實可以算出四個
        不同的「頻寬」，12.9 kHz 只是其中兩個（<ErratumTag eid="E06" /> <ErratumTag eid="E10" /> <ErratumTag eid="E26" />）：
      </p>
      <div className="table-wrap">
        <table className="fr-table fr-bw-table">
          <thead>
            <tr>
              <th>名稱</th>
              <th>公式</th>
              <th>T14 的數值</th>
              <th>與 exact −3 dB 的差</th>
              <th>拿來做什麼</th>
              <th>標籤</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label="名稱">exact −3 dB corner</td>
              <td data-label="公式">
                <Tex>{String.raw`\frac{f_u}{2\pi}\,2\arcsin\frac{1-p}{2\sqrt p}`}</Tex>
              </td>
              <td data-label="數值">
                <Tex>{texHz(lp.f3dbExact, 5)}</Tex>
              </td>
              <td data-label="差">—</td>
              <td data-label="用途">描述「多快的擾動追得上」</td>
              <td data-label="標籤">
                <ClaimTag kind="exact" />
              </td>
            </tr>
            <tr>
              <td data-label="名稱">
                <Tex>{String.raw`-\ln p`}</Tex> 近似
              </td>
              <td data-label="公式">
                <Tex>{String.raw`\frac{f_u}{2\pi}(-\ln p)`}</Tex>
              </td>
              <td data-label="數值">
                <Tex>{texHz(lp.f3dbNegLnP, 5)}</Tex>
              </td>
              <td data-label="差">
                <Tex>{texPct(errNegLnP, 2)}</Tex>
              </td>
              <td data-label="用途">
                時間常數 <Tex>{String.raw`\tau=-1/\ln p`}</Tex> 的頻域說法
              </td>
              <td data-label="標籤">
                <ClaimTag kind="approx" />
              </td>
            </tr>
            <tr>
              <td data-label="名稱">
                <Tex>{'(1-p)'}</Tex> 近似
              </td>
              <td data-label="公式">
                <Tex>{String.raw`\frac{f_u}{2\pi}(1-p)`}</Tex>
              </td>
              <td data-label="數值">
                <Tex>{texHz(lp.f3dbOneMinusP, 5)}</Tex>
              </td>
              <td data-label="差">
                <Tex>{texPct(errOneMinusP, 2)}</Tex>
              </td>
              <td data-label="用途">心算（一階）</td>
              <td data-label="標籤">
                <ClaimTag kind="approx" />
              </td>
            </tr>
            <tr>
              <td data-label="名稱">ENBW（one-sided）</td>
              <td data-label="公式">
                <Tex>{String.raw`\frac{f_u}{2}\cdot\frac{1-p}{1+p}`}</Tex>
              </td>
              <td data-label="數值">
                <Tex>{texHz(lp.enbw, 5)}</Tex>
              </td>
              <td data-label="差">
                <Tex>{String.raw`\times${texNum(lp.enbwOverF3db)}`}</Tex>
              </td>
              <td data-label="用途">
                <strong>積分白雜訊</strong>：<Tex>{String.raw`\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}`}</Tex>
              </td>
              <td data-label="標籤">
                <ClaimTag kind="exact" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        前三個都是同一件事（−3 dB corner）的精確值與兩個近似；第四個是完全不同的量。把 corner 當成 noise bandwidth 去乘 <Tex>{String.raw`S_w^{(1)}(0)`}</Tex>，得到{' '}
        <Tex>{String.raw`${texNum(lp.sigmaFromF3db)}\,\mathrm{fs}`}</Tex>，比正確的 <Tex>{String.raw`\sigma_w=${texNum(lp.sigmaW)}\,\mathrm{fs}`}</Tex> 低{' '}
        <Tex>{texPct(1 - lp.sigmaFromF3db / lp.sigmaW, 3)}</Tex>。
      </p>

      <Prereq title="Z 轉換、頻率響應與 pole">
        <p>
          Z 轉換把一條序列 <Tex>{'y_k'}</Tex> 換成 <Tex>{'z'}</Tex> 的函數 <Tex>{String.raw`Y(z)=\sum_ky_k\,z^{-k}`}</Tex>。只需要記一個性質：<strong>提前一步等於乘 </strong>
          <Tex>{'z'}</Tex>（延後一步乘 <Tex>{'z^{-1}'}</Tex>）。於是遞迴式變成代數式：
        </p>
        <TexBlock>{String.raw`y_{k+1}=p\,y_k+\mu\,\eta_k\ \xrightarrow{\ \text{Z 轉換}\ }\ z\,Y(z)=p\,Y(z)+\mu\,E(z)\ \Rightarrow\ H(z)\triangleq\frac{Y(z)}{E(z)}=\frac{\mu}{z-p}`}</TexBlock>
        <p>
          讓分母為零的 <Tex>{'z=p'}</Tex> 叫 <strong>pole</strong>：系統被敲一下之後的反應是 <Tex>{'p^k'}</Tex> 型，<Tex>{String.raw`|p|<1`}</Tex> 才會衰減（穩定），<Tex>{'p<0'}</Tex> 時正負交替。
          把 <Tex>{String.raw`z=e^{j\Omega}`}</Tex>（複數平面單位圓上的點）代入，<Tex>{String.raw`|H(e^{j\Omega})|`}</Tex> 就是角頻率 <Tex>{String.raw`\Omega`}</Tex> 的弦波通過系統後振幅被乘上的倍數——這叫頻率響應；
          <Tex>{String.raw`\Omega=0`}</Tex>（<Tex>{'z=1'}</Tex>）是 DC。
        </p>
      </Prereq>
      <Prereq title="等比級數、獨立變數的變異數相加、複數的長度">
        <p>
          （1）<Tex>{String.raw`|r|<1`}</Tex> 時 <Tex>{String.raw`\sum_{k=0}^{\infty}r^k=\frac{1}{1-r}`}</Tex>（把部分和乘上 <Tex>{'1-r'}</Tex> 就會前後相消）。 （2）獨立、零平均的隨機變數相加，變異數相加：
          <Tex>{String.raw`\operatorname{Var}\big(\sum_kh_k\eta_k\big)=\sigma_\eta^2\sum_kh_k^2`}</Tex>。 （3）單位圓上的點 <Tex>{String.raw`e^{j\Omega}=\cos\Omega+j\sin\Omega`}</Tex>；複數{' '}
          <Tex>{String.raw`e^{j\Omega}-p`}</Tex> 的長度平方是 <Tex>{String.raw`(\cos\Omega-p)^2+\sin^2\Omega=1-2p\cos\Omega+p^2`}</Tex>。
        </p>
      </Prereq>
      <Collapsible title="推導 1：exact −3 dB 頻率，以及它什麼時候不存在" beginnerOpen={false}>
        <StepDerivation
          steps={[
            {
              tex: String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\,\eta_k\ \Rightarrow\ H_{\eta\to w}(z)=\frac{\mu}{z-p}`,
              why: <>線性化的係數遞迴（<Tex>{String.raw`\delta w=w-w^*`}</Tex>）；取 Z 轉換：<Tex>{String.raw`z\,W=p\,W+\mu\,E`}</Tex>。</>,
            },
            {
              tex: String.raw`|H(e^{j\Omega})|^2=\frac{\mu^2}{|e^{j\Omega}-p|^2}=\frac{\mu^2}{1-2p\cos\Omega+p^2}`,
              why: <>在單位圓上求值（<Tex>{String.raw`\Omega`}</Tex>：rad/block）；分母用先備知識（3）。</>,
            },
            { tex: String.raw`|H(1)|^2=\frac{\mu^2}{(1-p)^2}`, why: <>DC（<Tex>{String.raw`\Omega=0`}</Tex>）的增益。</> },
            {
              tex: String.raw`\frac{|H(e^{j\Omega})|^2}{|H(1)|^2}=\frac12\ \Longleftrightarrow\ 1-2p\cos\Omega+p^2=2(1-p)^2`,
              why: '−3 dB 的定義：功率降到 DC 的一半。',
            },
            {
              tex: String.raw`\cos\Omega_{3\mathrm{dB}}=\frac{1+p^2-2(1-p)^2}{2p}=1-\frac{(1-p)^2}{2p}`,
              why: <>解出 <Tex>{String.raw`\cos\Omega`}</Tex>，並把分子寫成 <Tex>{String.raw`2p-(1-p)^2`}</Tex>。</>,
            },
            {
              tex: String.raw`\sin\frac{\Omega_{3\mathrm{dB}}}{2}=\frac{1-p}{2\sqrt p}`,
              why: (
                <>
                  半角公式 <Tex>{String.raw`1-\cos\Omega=2\sin^2(\Omega/2)`}</Tex>：這個寫法在 <Tex>{String.raw`p\to1`}</Tex> 時數值上比 <Tex>{String.raw`\arccos`}</Tex> 穩定（程式用的就是它）。
                </>
              ),
            },
            {
              tex: String.raw`\frac{1-p}{2\sqrt p}\le1\ \Longleftrightarrow\ (\sqrt p)^2+2\sqrt p-1\ge0\ \Longleftrightarrow\ \sqrt p\ge\sqrt2-1\ \Longleftrightarrow\ p\ge3-2\sqrt2\approx${texNum(lp.pMin3db)}`,
              why: (
                <>
                  <Tex>{String.raw`\sin`}</Tex> 不能超過 1：<Tex>{'p'}</Tex> 太小時，<Tex>{String.raw`|H|^2`}</Tex> 一路到 Nyquist（<Tex>{String.raw`\Omega=\pi`}</Tex>）都還高於 DC 的一半，−3 dB 點<strong>不存在</strong>（
                  <ErratumTag eid="E27" />）。
                </>
              ),
            },
            {
              tex: String.raw`f_{3\mathrm{dB}}=\frac{\Omega_{3\mathrm{dB}}}{2\pi}\,f_u=\frac{${texNum(lp.omega3dbBlock)}}{2\pi}\times${texHz(lp.fu, 6)}=${texHz(lp.f3dbExact, 5)}`,
              why: (
                <>
                  rad/block 換成 Hz：乘上 <Tex>{String.raw`f_u/2\pi`}</Tex>（不是 <Tex>{'f_s'}</Tex>！同一個頻率在 sample 軸上是 <Tex>{String.raw`${texNum(lp.theta3dbSample)}\,\mathrm{rad/sample}`}</Tex>）。
                </>
              ),
            },
          ]}
          result={String.raw`f_{3\mathrm{dB}}=\frac{f_u}{\pi}\arcsin\frac{1-p}{2\sqrt p},\qquad 3-2\sqrt2\le p<1`}
        />
      </Collapsible>
      <Collapsible title="推導 2：兩個近似各差多少（泰勒展開）" beginnerOpen={false}>
        <StepDerivation
          steps={[
            {
              tex: String.raw`\varepsilon_p\triangleq1-p\ (=g),\qquad \Omega_{3\mathrm{dB}}=2\arcsin\frac{\varepsilon_p}{2\sqrt{1-\varepsilon_p}}`,
              why: <>用小量 <Tex>{String.raw`\varepsilon_p`}</Tex> 重寫（慢迴路：<Tex>{String.raw`\varepsilon_p\ll1`}</Tex>）。</>,
            },
            {
              tex: String.raw`\frac{\varepsilon_p}{2\sqrt{1-\varepsilon_p}}=\frac{\varepsilon_p}{2}\Big(1+\frac{\varepsilon_p}{2}+\frac{3\varepsilon_p^2}{8}+\cdots\Big),\qquad \arcsin y=y+\frac{y^3}{6}+\cdots`,
              why: <>兩個標準的泰勒展開：<Tex>{String.raw`(1-\varepsilon)^{-1/2}`}</Tex> 與 <Tex>{String.raw`\arcsin`}</Tex>。</>,
            },
            {
              tex: String.raw`\Omega_{3\mathrm{dB}}=\varepsilon_p+\frac{\varepsilon_p^2}{2}+\frac{5\,\varepsilon_p^3}{12}+\cdots`,
              why: <>代入並整理到三階：<Tex>{String.raw`\tfrac38+\tfrac1{24}=\tfrac5{12}`}</Tex>。</>,
            },
            {
              tex: String.raw`-\ln p=-\ln(1-\varepsilon_p)=\varepsilon_p+\frac{\varepsilon_p^2}{2}+\frac{\varepsilon_p^3}{3}+\cdots`,
              why: <>對數的泰勒展開：前兩項和 exact 完全一樣，第三項差 <Tex>{String.raw`\varepsilon_p^3/12`}</Tex>。</>,
            },
            {
              tex: String.raw`\frac{-\ln p}{\Omega_{3\mathrm{dB}}}-1\approx-\frac{\varepsilon_p^2}{12}=${texPct(-(eps * eps) / 12, 2)}\quad(\text{實際 }${texPct(errNegLnP, 2)}),\qquad \frac{1-p}{\Omega_{3\mathrm{dB}}}-1\approx-\frac{\varepsilon_p}{2}=${texPct(-eps / 2, 3)}\quad(\text{實際 }${texPct(errOneMinusP, 3)})`,
              why: (
                <>
                  代入 <Tex>{String.raw`\varepsilon_p=${texNum(eps)}`}</Tex>：<Tex>{String.raw`-\ln p`}</Tex> 是二階準確、<Tex>{'(1-p)'}</Tex> 只有一階準確，兩者不能用「≈」串在一起。
                </>
              ),
            },
          ]}
        />
      </Collapsible>
      <Collapsible title="推導 3：ENBW 從哪來（時域的等比級數就夠了）" beginnerOpen={false}>
        <StepDerivation
          steps={[
            {
              tex: String.raw`h_k=\mu\,p^{\,k-1}\quad(k\ge1)`,
              why: (
                <>
                  impulse response：在 <Tex>{String.raw`\eta_0=1`}</Tex> 打一下，<Tex>{String.raw`\delta w_1=\mu`}</Tex>，之後每個 block 乘 <Tex>{'p'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\sigma_w^2=\sigma_\eta^2\sum_{k\ge1}h_k^2=\mu^2\sigma_\eta^2\sum_{j\ge0}(p^2)^j=\frac{\mu^2\sigma_\eta^2}{1-p^2}`,
              why: (
                <>
                  先備知識（2）與（1）：獨立的 <Tex>{String.raw`\eta_k`}</Tex> 各自貢獻變異數，公比是 <Tex>{'p^2'}</Tex>。
                </>
              ),
            },
            { tex: String.raw`H(1)=\sum_{k\ge1}h_k=\frac{\mu}{1-p}`, why: <>DC 增益是 impulse response 的總和（公比 <Tex>{'p'}</Tex> 的等比級數）。</> },
            {
              tex: String.raw`S_w^{(1)}(0)=|H(1)|^2\,S_\eta^{(1)}=\frac{\mu^2}{(1-p)^2}\cdot\frac{2\sigma_\eta^2}{f_u}`,
              why: <>白雜訊的單邊 PSD 是 <Tex>{String.raw`2\sigma_\eta^2/f_u`}</Tex>（§2.5），通過濾波器後乘上功率增益。</>,
            },
            {
              tex: String.raw`\mathrm{ENBW}\triangleq\frac{\sigma_w^2}{S_w^{(1)}(0)}=\frac{\mu^2\sigma_\eta^2}{1-p^2}\cdot\frac{(1-p)^2f_u}{2\mu^2\sigma_\eta^2}=\frac{f_u}{2}\cdot\frac{(1-p)^2}{(1-p)(1+p)}`,
              why: '定義：「高度等於 DC 的 PSD、面積等於總變異數」的矩形，寬度是多少？',
            },
            {
              tex: String.raw`\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}=${texHz(lp.enbw, 5)}`,
              why: (
                <>
                  約分並代入 T14 的 <Tex>{'p'}</Tex>。<Tex>{String.raw`\mu`}</Tex> 與 <Tex>{String.raw`\sigma_\eta`}</Tex> 都消掉了：ENBW 只是濾波器形狀的性質。
                </>
              ),
            },
            {
              tex: String.raw`\frac{\mathrm{ENBW}}{f_{3\mathrm{dB}}}\ \xrightarrow{\ p\to1\ }\ \frac{f_u\varepsilon_p/4}{f_u\varepsilon_p/(2\pi)}=\frac{\pi}{2}\approx1.571\qquad(\text{本例 }${texNum(lp.enbwOverF3db, 5)})`,
              why: (
                <>
                  慢迴路的極限：一階 low-pass 的 noise bandwidth 比 −3 dB corner 寬約 57%。用 corner 代替會少算 <Tex>{String.raw`1-2/\pi\approx36\%`}</Tex> 的功率、
                  <Tex>{String.raw`1-\sqrt{2/\pi}\approx20\%`}</Tex> 的 RMS。
                </>
              ),
            },
          ]}
          result={String.raw`\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p},\qquad \sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}`}
        />
      </Collapsible>

      <h4 className="fr-sub">
        <Tex>{'p'}</Tex> 落在哪一段，「頻寬」的意義就不同（<ErratumTag eid="E27" />）
      </h4>
      <div className="table-wrap">
        <table className="fr-table fr-regime-table">
          <thead>
            <tr>
              <th>
                <Tex>{String.raw`g=\mu K`}</Tex>
              </th>
              <th>
                <Tex>{'p=1-g'}</Tex>
              </th>
              <th>型態</th>
              <th>
                exact <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex>
              </th>
              <th>
                <Tex>{'(1-p)'}</Tex> 近似給的數字
              </th>
              <th>ENBW</th>
              <th>
                <Tex>{String.raw`\sigma_w`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {regimes.map(({ g, loop }) => (
              <tr key={g}>
                <td data-label="g">
                  <Tex>{texNum(g)}</Tex>
                </td>
                <td data-label="p">
                  <Tex>{texNum(loop.p)}</Tex>
                </td>
                <td data-label="型態">
                  <Rich text={regimeLabelTex(REGIME_LABEL[loop.regime])} />
                </td>
                <td data-label="f_3dB">{Number.isFinite(loop.f3dbExact) ? <Tex>{texHz(loop.f3dbExact)}</Tex> : <span className="fr-none">不存在</span>}</td>
                <td data-label="(1−p) 近似">
                  {Number.isFinite(loop.f3dbOneMinusP) ? (
                    <>
                      <Tex>{texHz(loop.f3dbOneMinusP)}</Tex>
                      {!Number.isFinite(loop.f3dbExact) && <span className="fr-none">（沒有意義）</span>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td data-label="ENBW">{Number.isFinite(loop.enbw) ? <Tex>{texHz(loop.enbw)}</Tex> : <span className="fr-none">不存在</span>}</td>
                <td data-label="σ_w">{Number.isFinite(loop.sigmaW) ? <Tex>{String.raw`${texNum(loop.sigmaW)}\,\mathrm{fs}`}</Tex> : <span className="fr-none">不存在</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        同一組 <Tex>{'N'}</Tex>、<Tex>{String.raw`\sigma_v`}</Tex>、<Tex>{'C'}</Tex>，只改 <Tex>{String.raw`\mu`}</Tex>（由 calLoop 計算）。<Tex>{'p<0'}</Tex> 時 ENBW 可以大於{' '}
        <Tex>{String.raw`f_u/2`}</Tex>：因為它以 DC 的 PSD 為基準，而 high-pass 的 DC 是最低點。<Tex>{String.raw`|p|\ge1`}</Tex> 時沒有穩態，任何「頻寬」都不該顯示。
      </p>
      <CodeCompare
        caption="四個函式都在 src/simulation/models/calNoise.ts；標示「← 差異」的那一行就是它們唯一不同的地方。"
        items={[
          { label: 'exact −3 dB', source: calNoiseSrc, region: 'bwExact', path: 'src/simulation/models/calNoise.ts', note: '解 $|H|^2=\\tfrac12|H(1)|^2$；$p<3-2\\sqrt2$ 時沒有解（程式回傳「非數值」）。' },
          { label: '−ln p 近似', source: calNoiseSrc, region: 'bwNegLnP', path: 'src/simulation/models/calNoise.ts', note: '等效連續時間 pole；相對誤差 $\\approx-(1-p)^2/12$。' },
          { label: '(1 − p) 近似', source: calNoiseSrc, region: 'bwOneMinusP', path: 'src/simulation/models/calNoise.ts', note: '只留一階；相對誤差 $\\approx-(1-p)/2$。' },
          { label: 'ENBW', source: calNoiseSrc, region: 'enbw', path: 'src/simulation/models/calNoise.ts', note: '積分用的等效矩形寬度；對所有 $|p|<1$ 都有定義。' },
        ]}
      />
      <div className="fr-topic-foot small">
        <ClaimTag kind="exact" /> <ClaimTag kind="approx" /> <SourceTag kind="illustrative" /> <PageLinks ids={['ch12']} /> <FormulaLinks ids={['F-12.3', 'F-12.7', 'F-12.8', 'F-12.9']} />
      </div>
    </Topic>
  )
}

export function MultirateTopic() {
  const r = refValues()
  const q = r.psd
  const N = T13_SETUP.N
  return (
    <Topic id="multirate" no="2.7" title="Multirate：block-rate 與 sample-rate 的頻譜不能直接混用">
      <p>
        <strong>一個問題：</strong>係數 <Tex>{String.raw`\delta w_k`}</Tex> 每個 block 才變一次（<Tex>{'f_u'}</Tex>），但它乘上的 code <Tex>{'x[n]'}</Tex> 每個 sample 都在變（<Tex>{'f_s'}</Tex>）。要算{' '}
        <Tex>{String.raw`\delta t[n]=x[n]\,\delta w[n]`}</Tex> 的頻譜，必須先把 <Tex>{String.raw`\delta w`}</Tex> 搬到 sample 軸上。規格 §12.2 直接把 block-rate 的 <Tex>{'S_w'}</Tex> 放進 sample-rate 的卷積（
        <ErratumTag eid="E09" /> <ErratumTag eid="E29" />）——頻率軸差 <Tex>{'N'}</Tex> 倍，形狀也不對。
      </p>
      <TexBlock>{String.raw`\delta w[n]=\delta w_{\lfloor (n-n_c)/N\rfloor}\qquad\Longrightarrow\qquad \boxed{S_w^{(f_s)}(e^{j\theta})=\frac{1}{N}\left[\frac{\sin(N\theta/2)}{\sin(\theta/2)}\right]^2S_w^{(f_u)}\big(e^{jN\theta}\big)}`}</TexBlock>
      <p className="small">
        <Tex>{String.raw`\theta`}</Tex>：rad/sample；<Tex>{String.raw`\Omega=N\theta`}</Tex>：rad/block（同一個物理頻率 <Tex>{'f'}</Tex>：<Tex>{String.raw`\theta=2\pi f/f_s`}</Tex>、
        <Tex>{String.raw`\Omega=2\pi f/f_u`}</Tex>）。這是 block 相位隨機的<strong>時間平均</strong> PSD。
      </p>
      <Collapsible
        title={
          <>
            推導：零階保持 = 補零上取樣 + 長度 <Tex>{'N'}</Tex> 的 boxcar 濾波器
          </>
        }
        beginnerOpen={false}
      >
        <StepDerivation
          steps={[
            {
              tex: String.raw`v[n]=\begin{cases}\delta w_{n/N},&n\text{ 是 }N\text{ 的倍數}\\0,&\text{其他}\end{cases}`,
              why: <>第一步：把 block 序列放到 sample 軸上，中間補 0（上取樣）。</>,
            },
            {
              tex: String.raw`S_v(e^{j\theta})=\frac1N\,S_w^{(f_u)}\big(e^{jN\theta}\big)`,
              why: (
                <>
                  補零讓頻率軸壓縮 <Tex>{'N'}</Tex> 倍（<Tex>{String.raw`\Omega=N\theta`}</Tex>）；每 <Tex>{'N'}</Tex> 個樣本只有一個非零，所以時間平均功率是 <Tex>{'1/N'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\delta w[n]=\sum_{r=0}^{N-1}v[n-r]\ \Rightarrow\ B(e^{j\theta})=\sum_{r=0}^{N-1}e^{-j\theta r}=\frac{1-e^{-jN\theta}}{1-e^{-j\theta}}`,
              why: <>第二步：「保持」就是把每個非零樣本往後複製 <Tex>{'N-1'}</Tex> 次——長度 <Tex>{'N'}</Tex> 的 boxcar；它的頻率響應是等比級數（公比 <Tex>{String.raw`e^{-j\theta}`}</Tex>）。</>,
            },
            {
              tex: String.raw`|B(e^{j\theta})|^2=\frac{|1-e^{-jN\theta}|^2}{|1-e^{-j\theta}|^2}=\frac{\sin^2(N\theta/2)}{\sin^2(\theta/2)}`,
              why: <>用 <Tex>{String.raw`|1-e^{-j\alpha}|^2=2-2\cos\alpha=4\sin^2(\alpha/2)`}</Tex>。</>,
            },
            {
              tex: String.raw`S_w^{(f_s)}(e^{j\theta})=|B|^2\,S_v=\frac1N\left[\frac{\sin(N\theta/2)}{\sin(\theta/2)}\right]^2S_w^{(f_u)}\big(e^{jN\theta}\big)`,
              why: '濾波器輸出的 PSD = 功率增益 × 輸入的 PSD。',
            },
            {
              tex: String.raw`\theta\to0:\quad S_w^{(f_s)}(1)=\frac{N^2}{N}\,S_w^{(f_u)}(1)=N\,S_w^{(f_u)}(1)=${N}\times${texNum(q.swDtftDc)}=${texNum(q.swZohDtftDc)}`,
              why: (
                <>
                  低頻極限：<Tex>{String.raw`\sin(N\theta/2)/\sin(\theta/2)\to N`}</Tex>。DTFT 形式在 DC 放大 <Tex>{'N'}</Tex> 倍（由 swZohDtft 算出，比值 <Tex>{texNum(q.zohOverBlockDtft)}</Tex>）。
                </>
              ),
            },
            {
              tex: String.raw`\frac{2}{f_s}\cdot N\,S_w^{(f_u)}(1)=\frac{2}{f_u}\,S_w^{(f_u)}(1)=${texNum(q.swZoh1Dc)}\ \mathrm{fs^2/Hz}`,
              why: (
                <>
                  換成單邊 per-Hz（<Tex>{String.raw`f_s=Nf_u`}</Tex>）：<strong>完全不變</strong>。慢慢變的訊號被「保持」之後，低頻的物理頻譜當然一樣；差 <Tex>{'N'}</Tex> 倍的只是 per-rad 的記帳方式。
                </>
              ),
            },
          ]}
        />
      </Collapsible>
      <div className="table-wrap">
        <table className="fr-table fr-zoh-table">
          <thead>
            <tr>
              <th>T13 條件，同一個物理頻率</th>
              <th>
                block-rate（<Tex>{'f_u'}</Tex>）
              </th>
              <th>
                ZOH 後 sample-rate（<Tex>{'f_s'}</Tex>）
              </th>
              <th>比值</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label="量">DC 的 DTFT 形式</td>
              <td data-label="f_u">
                <Tex>{texNum(q.swDtftDc)}</Tex>
              </td>
              <td data-label="f_s">
                <Tex>{texNum(q.swZohDtftDc)}</Tex>
              </td>
              <td data-label="比值">
                <Tex>{String.raw`N=${texNum(q.zohOverBlockDtft)}`}</Tex>（<Tex>{String.raw`${texNum(10 * Math.log10(N), 4)}\,\mathrm{dB}`}</Tex>）
              </td>
            </tr>
            <tr>
              <td data-label="量">DC 的單邊 per-Hz</td>
              <td data-label="f_u">
                <Tex>{String.raw`${texNum(q.sw1Dc)}\,\mathrm{fs^2/Hz}`}</Tex>
              </td>
              <td data-label="f_s">
                <Tex>{String.raw`${texNum(q.swZoh1Dc)}\,\mathrm{fs^2/Hz}`}</Tex>
              </td>
              <td data-label="比值">1（物理量不變）</td>
            </tr>
            <tr>
              <td data-label="量">
                <Tex>{String.raw`f=f_u/2`}</Tex> 的單邊 per-Hz
              </td>
              <td data-label="f_u">基準</td>
              <td data-label="f_s">
                乘上 <Tex>{String.raw`\big[\frac{\sin(\pi/2)}{N\sin(\pi/2N)}\big]^2`}</Tex>
              </td>
              <td data-label="比值">
                <Tex>{String.raw`${texNum(q.zohDroopAtHalfFu)}\approx(2/\pi)^2`}</Tex>（<Tex>{String.raw`${texNum(q.zohDroopDb, 3)}\,\mathrm{dB}`}</Tex>，sinc droop）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout kind="warn" title="三個常見的錯">
        <ol className="fr-compact">
          <li>
            把 block-rate 的 DTFT 形式直接畫在 sample 軸上：頻率差 <Tex>{'N'}</Tex> 倍、位準差 <Tex>{'N'}</Tex> 倍。
          </li>
          <li>
            忘了 hold 的 <Tex>{String.raw`\mathrm{sinc}^2`}</Tex> 形狀：在 <Tex>{'f_u'}</Tex> 的整數倍有零點，倍數附近有 images。
          </li>
          <li>
            號誌：DTC 多施加的延遲是 <Tex>{String.raw`\delta t=x\,\delta w`}</Tex>，但它在殘餘 timing error 裡的貢獻是 <Tex>{String.raw`-x\,\delta w`}</Tex>（<Tex>{String.raw`\delta w=w-w^*`}</Tex>，與{' '}
            <Tex>{String.raw`\delta=a-w`}</Tex> 反號；<ErratumTag eid="E33" />）。算與直接 PD 路徑的 cross-spectrum 時號誌錯了，相關係數就反號。
          </li>
        </ol>
      </Callout>
      <Collapsible title="核心程式碼：ZOH 之後的 sample-rate PSD（calNoise.ts）">
        <CodeBlock
          source={calNoiseSrc}
          region="zohPsd"
          path="src/simulation/models/calNoise.ts"
          caption="$\theta\to0$ 的極限（$N^2$）要另外處理，否則是 0/0。乘上 code 之後的 $S_{\delta t}$ 見第 12 章 §12.2。"
        />
      </Collapsible>
      <Gate min="research">
        <Callout kind="info" title="Research：時間平均 PSD 只是摘要">
          <p>
            ZOH 之後的 <Tex>{String.raw`\delta w[n]`}</Tex> 是週期平穩（cyclostationary）過程：它的統計特性以 <Tex>{'N'}</Tex> 個 sample 為週期（block 邊界是特殊的時刻）。上面的公式是對 block 相位平均後的結果；
            若 code <Tex>{'x[n]'}</Tex> 本身也有與 block 同步的週期結構（例如 DSM pattern 的週期與 <Tex>{'N'}</Tex> 有公因數），<Tex>{String.raw`x\,\delta w`}</Tex> 的頻譜會多出時間平均公式看不到的交叉項。
            這屬於研究題目 R2（Roadmap 頁），本站只驗證了白色 code 的情況。
          </p>
        </Callout>
      </Gate>
      <div className="fr-topic-foot small">
        <ClaimTag kind="exact" /> <ClaimTag kind="research" /> <SourceTag kind="illustrative" /> <PageLinks ids={['ch12', 'ch13', 'roadmap']} /> <FormulaLinks ids={['F-12.11', 'F-12.13', 'F-12.14']} />
      </div>
    </Topic>
  )
}
