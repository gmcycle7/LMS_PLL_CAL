import { useMemo } from 'react'
import { ClaimTag, CodeBlock, ModeGate, Prereq, Quiz, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import polaritySrc from '@/simulation/models/polarity.ts?raw'
import { lfilter } from '@/simulation/signal'
import { calPole, empiricalLargeErrorGain, kqFromSigma, toneCorrelation, toneLargeErrorGain, tonePath } from '@/simulation/models/polarity'
import { ChapterDiagram, ChapterHandCalc, ChapterSection, f, fx, radOf, StepBox } from '../shared'

const PATH = 'src/simulation/models/polarity.ts'

/** §3 GMAC 用原始 x 時的平均增益與 pole；三種情況；μ 為什麼救不回來 */
export function S3GmacPole() {
  const Kq = kqFromSigma(100)
  const C = toneCorrelation({ A: 1, mag: 1, phiRad: radOf(120), omega: Math.PI / 6 }) // §1 的例子（T06）
  const muRows = [10, 1, 0.1].map((mu) => {
    const p = calPole(mu, Kq, C)
    return { mu, p, efold: 1 / Math.log(p), doubling: Math.LN2 / Math.log(p) }
  })
  // 大誤差極限：等分布公式 vs Ω = π/6（週期 12）的實際離散平均
  const large = useMemo(() => {
    const omega = Math.PI / 6
    const phi = radOf(120)
    const path = tonePath(1, phi, omega)
    const M = 1200
    const x = new Float64Array(M + 1).map((_, i) => Math.cos(omega * (i - 1)))
    const u = lfilter(path.b, path.a, x).y
    return { formula: toneLargeErrorGain(1, phi, omega), discrete: empiricalLargeErrorGain(x, u, 1) }
  }, [])

  return (
    <ChapterSection
      id="ch06-s3"
      kicker="§3"
      title={
        <>
          GMAC 用原始 <Tex>{'x'}</Tex>：<Tex>{'G\\approx K_q(a-w)C'}</Tex> 與 pole <Tex>{'p=1-\\mu K_qC'}</Tex>
        </>
      }
    >
      <p>
        現在把 §2 的結果接上<ChRef ch="05">第 05 章</ChRef>的 comparator。硬體 GMAC 做的事很簡單：每個 sample 依 comparator 的正負號對 code 做
        conditional negate，再累加 <Tex>{'N'}</Tex> 個 sample：
      </p>
      <TexBlock>{String.raw`G_k=\frac1N\sum_{n\in\text{block }k}q[n]\,x[n-D],\qquad w_{k+1}=w_k+\mu\,G_k`}</TexBlock>
      <p>
        式中 <Tex>{'G_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 的 GMAC 平均輸出，<Tex>{'N'}</Tex> 是每個 block 的 sample 數，<Tex>{'q[n]=\\pm1'}</Tex> 是 comparator
        的正負號，<Tex>{'D'}</Tex> 是 GMAC 把 code 延遲的 sample 數（code delay），<Tex>{'w_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 使用的 gain 校正值，<Tex>{'\\mu'}</Tex>{' '}
        是 learning rate。
      </p>
      <p>
        關鍵：它乘的是<strong>原始</strong>（或延遲 <Tex>{'D'}</Tex> 的）code <Tex>{'x'}</Tex>，但誤差裡出現的是 <Tex>{'u'}</Tex>。本節先取 <Tex>{'D=0'}</Tex>{' '}
        的 raw-x 情況，§4 起保留一般的 <Tex>{'D'}</Tex>。
      </p>

      <Prereq title={String.raw`期望值 $E[\cdot]$ 與時間平均`}>
        <p>
          <Tex>{'E[\\cdot]'}</Tex> 是「把同一個實驗重複很多次再平均」。comparator 雜訊 <Tex>{'v'}</Tex> 每次都不同，所以 <Tex>{'q'}</Tex> 是隨機的；code <Tex>{'x'}</Tex> 則是已知、確定的序列，在求期望值時可以當常數提出來（期望值是線性的：<Tex>{'E[cX+Y]=cE[X]+E[Y]'}</Tex>）。
        </p>
        <p>
          對確定性的週期 code，「很多次的平均」由「很長時間的平均」代替：<Tex>{'E[x\\,u]\\equiv\\lim_{M\\to\\infty}\\frac1M\\sum_{n}x[n]u[n]'}</Tex>。 <ChRef ch="05">第 05 章</ChRef>已證明：<Tex>{'E[q\\mid s]=\\mathrm{erf}\\big(s/(\\sqrt2\\sigma_v)\\big)\\approx K_q\\,s'}</Tex>，<Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>（<Tex>{'|s|\\ll\\sigma_v'}</Tex>）。
        </p>
      </Prereq>
      <Prereq title="相關（correlation）是什麼？">
        <p>
          兩個訊號逐點相乘再平均：<Tex>{'E[x\\,u]\\approx\\frac1M\\sum_{n}x[n]\\,u[n]'}</Tex>。若它們傾向<strong>同號</strong>（一起正、一起負），乘積多半為正，相關為正；若彼此無關或剛好錯開{' '}
          <Tex>{'90^\\circ'}</Tex>，正負抵消，相關為 0；若傾向<strong>反號</strong>，相關為負。§1 的手算表就是在算這個量。
        </p>
      </Prereq>

      <p>
        <strong>平均來看，GMAC 輸出多少？</strong>白話：comparator 的輸出 <Tex>{'q'}</Tex> 雖然只有 <Tex>{'\\pm1'}</Tex>，但誤差越正，它出 <Tex>{'+1'}</Tex>{' '}
        的機率越高，所以 <Tex>{'q'}</Tex> 的平均值 <Tex>{'E[q]'}</Tex> 會跟著誤差走。GMAC 把這個平均值乘上 code 再平均，結果就正比於「參數誤差 × 相關」。
      </p>
      <ChapterDiagram id="D-06.5">
        <p>
          先看 comparator 那一塊：輸入是誤差裡不含雜訊的確定部分 <Tex>{'e_{\\det}[n]=\\delta_k\\,u[n]'}</Tex>，輸出是 <Tex>{'q'}</Tex> 的平均值，它沿著一條 S 形曲線{' '}
          <Tex>{'\\mathrm{erf}'}</Tex> 變化（<Tex>{'\\sigma_v'}</Tex> 是雜訊 <Tex>{'v'}</Tex> 的 RMS）。再沿實線往下看：誤差遠小於 <Tex>{'\\sigma_v'}</Tex> 時，S
          形曲線在原點附近是一條斜率 <Tex>{'K_q'}</Tex> 的直線；乘上 regressor <Tex>{'x[n-D]'}</Tex>、對一個 block 平均，就得到藍色方塊。虛線是誤差很大的情況：
          <Tex>{'\\mathrm{erf}'}</Tex> 飽和成 <Tex>{'\\pm1'}</Tex>，平均更新不再和 <Tex>{'\\delta'}</Tex> 成正比（Research 模式的推導與 §6.4 但書 1 會用到）。
        </p>
        <p>
          圖上的「× 之後取 block 平均」就是公式裡的 <Tex>{'\\tfrac1N\\sum_n x[n-D]\\,(\\cdot)'}</Tex>；把常數 <Tex>{'K_q\\,\\delta_k'}</Tex> 提出來之後，剩下的{' '}
          <Tex>{'\\tfrac1N\\sum_n x[n-D]\\,u[n]'}</Tex> 就是圖上的相關 <Tex>{'C_D'}</Tex>——對應下面推導的第 3、4 步。
        </p>
      </ChapterDiagram>
      <StepBox title="GMAC 的平均輸出">
        <StepDerivation
          steps={[
            {
              tex: String.raw`E[G_k]=\frac1N\sum_n x[n-D]\;E\big[q[n]\big]`,
              why: (
                <>
                  <Tex>{'x'}</Tex> 已知，可以提到期望值外面；期望值只對 comparator 雜訊 <Tex>{'v'}</Tex> 取。
                </>
              ),
            },
            {
              tex: String.raw`E\big[q[n]\big]=\mathrm{erf}\!\Big(\frac{e_{\det}[n]}{\sqrt2\,\sigma_v}\Big)\approx K_q\,e_{\det}[n],\quad e_{\det}[n]=(a-w_k)\,u[n]`,
              why: (
                <>
                  <ChRef ch="05">第 05 章</ChRef>的 comparator 公式；小訊號 <Tex>{'|e_{\\det}|\\ll\\sigma_v'}</Tex> 時用切線（一階泰勒）近似。
                </>
              ),
            },
            {
              tex: String.raw`E[G_k]\approx K_q\,(a-w_k)\,\frac1N\sum_n x[n-D]\,u[n]`,
              why: (
                <>
                  代入，常數 <Tex>{'K_q(a-w_k)'}</Tex> 提出求和。
                </>
              ),
            },
            {
              tex: String.raw`\approx K_q\,(a-w_k)\,C_D,\qquad C_D=E\big[x[n-D]\,u[n]\big]`,
              why: (
                <>
                  <Tex>{'N'}</Tex> 夠大時，block 平均近似等於長時間平均（有限 <Tex>{'N'}</Tex> 的 ripple 見 §4 的 E46）。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-06.2">{String.raw`\boxed{E[G_k]\approx K_q\,(a-w_k)\,C_D}`}</TexBlock>
        <p className="ch06-tags">
          <ClaimTag kind="approx" />
          <span className="small">小訊號、Gaussian 雜訊、長時間平均。若 GMAC 用的是 <Tex>{'u'}</Tex> 而不是 <Tex>{'x'}</Tex>，<Tex>{'C'}</Tex> 會變成 <Tex>{'E[u^2]\\ge0'}</Tex>——這就是 filtered-x 的想法（<ChRef ch="07">第 07 章</ChRef>）。</span>
        </p>
      </StepBox>

      <p>
        <strong>誤差每個 block 變成幾倍？</strong>有了平均輸出，更新律 <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex> 就變成參數誤差 <Tex>{'\\delta_k=a-w_k'}</Tex>{' '}
        的一個一階迴圈：每過一個 block，平均誤差被減掉「<Tex>{'\\mu K_qC'}</Tex> 倍的自己」。
      </p>
      <ChapterDiagram id="D-06.6">
        <p>
          先看直接連到加法點的那條線：平均誤差 <Tex>{'E[\\delta_k]'}</Tex> 以「＋」號進入加法點。再看繞過去的支路：同一個誤差乘上藍色的 <Tex>{'K_qC'}</Tex> 變成 GMAC
          的平均輸出 <Tex>{'E[G_k]'}</Tex>，再乘上 <Tex>{'\\mu'}</Tex>，以「−」號進入加法點；加法點的輸出等一個 block（<Tex>{'z^{-1}'}</Tex>）之後，成為下一個{' '}
          <Tex>{'E[\\delta_k]'}</Tex>。關鍵是藍色方塊的正負：<Tex>{'C>0'}</Tex> 時這條支路是負回授，誤差一圈一圈縮小；<Tex>{'C<0'}</Tex>{' '}
          時負負得正，變成<strong>正回授</strong>——不管 <Tex>{'\\mu'}</Tex> 多小，誤差都一圈一圈放大。
        </p>
        <p>
          圖上的加法點就是公式 <Tex>{'E[\\delta_{k+1}]=E[\\delta_k]-\\mu K_qC\\,E[\\delta_k]'}</Tex>；把兩條路合起來，繞一圈的倍數{' '}
          <Tex>{'p=1-\\mu K_qC'}</Tex> 就是 pole。這是 block rate 的迴圈（索引 <Tex>{'k'}</Tex>），和圖 6.4 裡 GMAC 之前的 sample rate（索引 <Tex>{'n'}</Tex>）不同。
        </p>
      </ChapterDiagram>
      <StepBox title="平均更新 pole">
        <StepDerivation
          steps={[
            {
              tex: String.raw`\delta_{k+1}=a-w_{k+1}=a-w_k-\mu G_k=\delta_k-\mu G_k`,
              why: (
                <>
                  更新律 <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex> 兩邊用 <Tex>{'a'}</Tex> 去減（<Tex>{'\\delta=a-w'}</Tex> 極性）。
                </>
              ),
            },
            {
              tex: String.raw`E[\delta_{k+1}]=E[\delta_k]-\mu K_qC\,E[\delta_k]`,
              why: (
                <>
                  取期望值，代入 <Tex>{'E[G_k]\\approx K_q\\,\\delta_k\\,C'}</Tex>（對 <Tex>{'\\delta'}</Tex> 是線性的）。
                </>
              ),
            },
            { tex: String.raw`E[\delta_{k+1}]=(1-\mu K_qC)\,E[\delta_k]=p\,E[\delta_k]`, why: '提出公因式。' },
            {
              tex: String.raw`E[\delta_k]=p^k\,\delta_0`,
              why: (
                <>
                  每一步乘上同一個 <Tex>{'p'}</Tex> ⇒ 等比數列。
                </>
              ),
            },
            {
              tex: String.raw`|p|<1\iff 0<\mu K_qC<2`,
              why: (
                <>
                  等比數列 <Tex>{'r^k\\to0\\iff|r|<1'}</Tex>（<ChRef ch="03">第 03 章</ChRef>）。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-06.3">{String.raw`\boxed{p=1-\mu K_qC}`}</TexBlock>
        <p className="ch06-tags">
          <ClaimTag kind="exact" />
          <span className="small">在「線性化平均模型」中精確（指定模型：block rate、average-mode GMAC、無更新延遲；更新延遲見<ChRef ch="08">第 08 章</ChRef>）。</span>
        </p>
      </StepBox>
      <p>
        習慣上把 <Tex>{'g=\\mu K_qC'}</Tex> 叫做校正迴路的 normalized loop gain（無因次）：<Tex>{'p=1-g'}</Tex>，所以平均收斂的條件 <Tex>{'|p|<1'}</Tex> 就是{' '}
        <Tex>{'0<g<2'}</Tex>。
      </p>

      <h3>三種情況</h3>
      <ChapterDiagram id="D-06.7">
        <p>
          從上往下讀：先問相關 <Tex>{'C'}</Tex> 的正負，再看 pole <Tex>{'p'}</Tex> 落在 1 的哪一邊，最後才輪到 <Tex>{'\\mu'}</Tex>。綠色那一格是唯一「<Tex>{'\\mu'}</Tex>{' '}
          有得選」的情況；棕色那一格 GMAC 完全沒有關於 <Tex>{'\\delta'}</Tex> 的資訊；紅色那一格無論 <Tex>{'\\mu'}</Tex> 多小都發散，出口只有一個——改變{' '}
          <Tex>{'C'}</Tex> 本身。
        </p>
        <p>
          圖上的三個 pole 就是把 <Tex>{'C>0'}</Tex>、<Tex>{'C=0'}</Tex>、<Tex>{'C<0'}</Tex> 分別代入 <Tex>{'p=1-\\mu K_qC'}</Tex>；下表是同一件事的文字版。
        </p>
      </ChapterDiagram>
      <div className="table-wrap">
        <table className="ch06-table">
          <thead>
            <tr>
              <th>
                <Tex>{'C'}</Tex> 的符號
              </th>
              <th>pole</th>
              <th>平均行為</th>
              <th>
                調整 <Tex>{'\\mu'}</Tex> 有用嗎？
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pos">
                <Tex>{'C>0'}</Tex>
              </td>
              <td className="nowrap">
                <Tex>{'p=1-\\mu K_qC<1'}</Tex>
              </td>
              <td>
                <Tex>{'0<\\mu<2/(K_qC)'}</Tex> 時平均收斂；<Tex>{'C'}</Tex> 越小越慢
              </td>
              <td>
                有用：選合適的 <Tex>{'\\mu'}</Tex> 決定速度與雜訊
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'C=0'}</Tex>
              </td>
              <td className="nowrap">
                <Tex>{'p=1'}</Tex>
              </td>
              <td>
                沒有平均恢復力；<Tex>{'w'}</Tex> 隨 GMAC 雜訊 random walk（變異數隨 <Tex>{'k'}</Tex> 線性成長）
              </td>
              <td>
                沒用：GMAC 根本沒有關於 <Tex>{'\\delta'}</Tex> 的資訊
              </td>
            </tr>
            <tr>
              <td className="neg">
                <Tex>{'C<0'}</Tex>
              </td>
              <td className="nowrap">
                <Tex>{'p=1+\\mu K_q|C|>1'}</Tex>
              </td>
              <td>
                任何 <Tex>{'\\mu>0'}</Tex> 都平均發散（正回授）
              </td>
              <td>
                <strong>沒用</strong>：<Tex>{'\\mu'}</Tex> 只改變發散速度，改變不了方向
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>
        為什麼「只減小 <Tex>{'\\mu'}</Tex> 不會改變符號」：用數字看
      </h3>
      <div className="table-wrap">
        <table className="ch06-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'\\mu\\,[\\mathrm{fs}]'}</Tex>
              </th>
              <th className="num">
                <Tex>{'p=1-\\mu K_qC'}</Tex>
              </th>
              <th className="num">
                誤差放大 <Tex>{'e'}</Tex> 倍所需 block（<Tex>{'1/\\ln p'}</Tex>）
              </th>
              <th className="num">誤差加倍所需 block</th>
            </tr>
          </thead>
          <tbody>
            {muRows.map((r) => (
              <tr key={r.mu}>
                <td className="num">{r.mu}</td>
                <td className="num">{fx(r.p, 6)}</td>
                <td className="num">{f(r.efold, 4)}</td>
                <td className="num">{f(r.doubling, 4)}</td>
              </tr>
            ))}
          </tbody>
          <caption>
            <Tex>{`C=${fx(C, 4)},\\;\\sigma_v=100\\,\\mathrm{fs}\\;(K_q=${f(Kq, 6)}\\,\\mathrm{fs}^{-1})`}</Tex>。<Tex>{'\\mu'}</Tex>{' '}
            每縮小 10 倍，發散時間常數約放大 10 倍，但 <Tex>{'p'}</Tex> 永遠 <Tex>{'>1'}</Tex>。
          </caption>
        </table>
      </div>
      <p>
        修正極性的正確方法是改變 <Tex>{'C'}</Tex> 本身：把 code 延遲 <Tex>{'D'}</Tex> 讓 <Tex>{'\\cos(\\phi+\\Omega D)>0'}</Tex>（delay alignment；<Tex>{'\\phi'}</Tex>{' '}
        是主 PLL 路徑在 code 頻率 <Tex>{'\\Omega'}</Tex> 的相位，§4 推導），或乘上模型化的 <Tex>{'u_f=\\hat h*x'}</Tex>（filtered-x）——<ChRef ch="07">第 07 章</ChRef>。直接把 <Tex>{'\\mu'}</Tex> 變號也能「修好」單一頻率，但{' '}
        <Tex>{'C'}</Tex> 的符號會隨 FCW、code 頻譜與迴路頻寬改變（§6.4），所以這不是可靠的設計。
      </p>

      <ChapterHandCalc
        id="HC-06.1"
        lead={String.raw`上面兩個表的每一格都只是 $p=1-\mu K_qC$。換成你自己的 $C$、$K_q$、$\mu$，先用紙筆算出 pole 與前兩個 block 的平均誤差，再看把 $\mu$ 減半有沒有用。`}
      />

      <h3>核心程式碼：這就是網站跑的 GMAC</h3>
      <p>
        閉迴路模擬（§7 的實驗）用的就是下面兩段。注意標成「差異」的行：誤差 <Tex>{'e'}</Tex> 裡面是被 PLL 濾過的 <Tex>{'H_{\\mathrm{PD}}\\{\\delta x\\}'}</Tex>，但 GMAC 乘的是 <Tex>{'x[n-D]'}</Tex>。
      </p>
      <CodeBlock source={polaritySrc} region="signLmsBlock" path={PATH} title="block sign-error LMS（逐 sample）" />
      <CodeBlock source={polaritySrc} region="buildRegressor" path={PATH} title={String.raw`GMAC regressor：raw / delayed $x$ vs filtered-x $u$`} />
      <CodeBlock source={polaritySrc} region="calPole" path={PATH} title={String.raw`平均 pole 與穩定的 $\mu$ 範圍`} />

      <ModeGate min="research">
        <StepBox
          title={
            <>
              （Research）不做小訊號近似：mean-field 特性 <Tex>{'E[G](\\delta)'}</Tex> 與大誤差極限的線性漂移
            </>
          }
          min="research"
        >
          <p>
            線性化只在 <Tex>{'|\\delta u|\\ll\\sigma_v'}</Tex> 成立。其實不必做這個近似：只要 <Tex>{'w'}</Tex> 在 <Tex>{'H_{\\mathrm{PD}}'}</Tex>{' '}
            的記憶長度內近似常數、comparator 雜訊是 Gaussian，GMAC 的平均對<strong>任意大小</strong>的 <Tex>{'\\delta'}</Tex> 都寫得出來：
          </p>
          <StepDerivation
            steps={[
              {
                tex: String.raw`E\big[q[n]\big]=\mathrm{erf}\!\Big(\frac{\delta\,u[n]}{\sqrt2\,\sigma_v}\Big)`,
                why: (
                  <>
                    <ChRef ch="05">第 05 章</ChRef>的精確式（<Tex>{'e_{\\det}=\\delta\\,u[n]'}</Tex>）；這一步還沒有做任何近似。
                  </>
                ),
              },
              {
                tex: String.raw`E[G](\delta)=\frac1N\sum_n x[n-D]\,\mathrm{erf}\!\Big(\frac{\delta\,u[n]}{\sqrt2\,\sigma_v}\Big)`,
                why: (
                  <>
                    代入 GMAC 的定義（<Tex>{'x'}</Tex> 是已知序列，提到期望值外）。這條 S 形曲線叫 mean-field 特性；它只和比值 <Tex>{'\\delta/\\sigma_v'}</Tex> 有關。
                  </>
                ),
              },
              {
                tex: String.raw`|\delta u|\ll\sigma_v:\;\mathrm{erf}(z)\approx\tfrac{2}{\sqrt\pi}z\;\Rightarrow\;E[G]\approx\sqrt{\tfrac2\pi}\frac{\delta}{\sigma_v}\cdot\frac1N\sum_n x[n-D]\,u[n]=K_q\,\delta\,C_D`,
                why: (
                  <>
                    一階泰勒展開 ⇒ 回到 F-06.2：小訊號斜率就是 <Tex>{'K_qC_D'}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`|\delta u|\gg\sigma_v:\;\mathrm{erf}(z)\to\operatorname{sign}(z)\;\Rightarrow\;E[G]\to\operatorname{sign}(\delta)\,E\big[x_D\operatorname{sign}(u)\big]`,
                why: (
                  <>
                    comparator 完全飽和：只剩正負號（<Tex>{'u[n]=0'}</Tex> 的 sample 貢獻 0）。
                  </>
                ),
              },
            ]}
          />
          <TexBlock id="F-06.19">{String.raw`\boxed{E[G](\delta)=\frac1N\sum_n x[n-D]\,\mathrm{erf}\!\Big(\frac{\delta\,u[n]}{\sqrt2\,\sigma_v}\Big)}`}</TexBlock>
          <p className="ch06-tags">
            <ClaimTag kind="approx" />
            <span className="small">
              條件：Gaussian 雜訊、時間尺度分離。平均動態是 <Tex>{'E[\\delta_{k+1}]-\\delta_k=-\\mu\\,E[G](\\delta_k)'}</Tex>：<Tex>{'E[G]'}</Tex> 與 <Tex>{'\\delta'}</Tex>{' '}
              同號就拉回 0，反號就推走。§7 的實驗畫出這條曲線，並拿它預測閉迴路在非線性區的漂移斜率。
            </span>
          </p>
          <p>
            <strong>單頻 code 的極性不隨誤差大小改變。</strong>令 <Tex>{'\\theta=\\Omega n+\\phi'}</Tex>、<Tex>{'\\psi=\\phi+\\Omega D'}</Tex>、
            <Tex>{'k=\\delta A|H|/(\\sqrt2\\sigma_v)'}</Tex>，相位等分布時
          </p>
          <TexBlock>{String.raw`E[G]=A\cos\psi\;\underbrace{E\big[\cos\theta\;\mathrm{erf}(k\cos\theta)\big]}_{\text{與 }\delta\text{ 同號}}+A\sin\psi\;\underbrace{E\big[\sin\theta\;\mathrm{erf}(k\cos\theta)\big]}_{=0\ (\theta\to-\theta\text{ 反對稱})}`}</TexBlock>
          <p>
            （和角公式 <Tex>{'\\cos(\\theta-\\psi)=\\cos\\theta\\cos\\psi+\\sin\\theta\\sin\\psi'}</Tex>；<Tex>{'k>0'}</Tex> 時 <Tex>{'\\cos\\theta'}</Tex> 與{' '}
            <Tex>{'\\mathrm{erf}(k\\cos\\theta)'}</Tex> 逐點同號，乘積 <Tex>{'\\ge0'}</Tex>。）所以 <Tex>{'E[G](\\delta)'}</Tex> 永遠和 <Tex>{'\\delta\\cos(\\phi+\\Omega D)'}</Tex> 同號：<Tex>{'C>0'}</Tex> 的單頻全域都往 0 拉，<Tex>{'C<0'}</Tex>{' '}
            的全域都往外推。<strong>會隨 <Tex>{'|\\delta|'}</Tex> 變號的，是 <Tex>{'C'}</Tex> 由正負貢獻相消而來的 code</strong>——近整數鋸齒經 Type-II 就是（§6.4）。下面先看單頻的大誤差極限：
          </p>
          <StepDerivation
            steps={[
              {
                tex: String.raw`q[n]=\operatorname{sign}(\delta_k u[n]+v[n])\approx\operatorname{sign}(\delta_k)\operatorname{sign}(u[n])`,
                why: (
                  <>
                    <Tex>{'|\\delta u|\\gg\\sigma_v'}</Tex>：雜訊幾乎翻轉不了符號（<Tex>{'u[n]=0'}</Tex> 的 sample 例外：那裡只剩雜訊，<Tex>{'q'}</Tex> 平均為 0）。
                  </>
                ),
              },
              {
                tex: String.raw`G_k\approx\operatorname{sign}(\delta_k)\,\frac1N\sum_n x[n-D]\operatorname{sign}(u[n])`,
                why: (
                  <>
                    代入 GMAC 定義，<Tex>{'\\operatorname{sign}(\\delta_k)'}</Tex> 在 block 內是常數。
                  </>
                ),
              },
              {
                tex: String.raw`E\big[A\cos(\theta-\psi)\operatorname{sign}(\cos\theta)\big]=A\cos\psi\,E|\cos\theta|=\frac{2A}{\pi}\cos\psi`,
                why: (
                  <>
                    單頻、相位 <Tex>{'\\theta=\\Omega n+\\phi'}</Tex> 在 <Tex>{'[0,2\\pi)'}</Tex> 等分布；<Tex>{'\\psi=\\phi+\\Omega D'}</Tex>；和角公式展開後{' '}
                    <Tex>{'\\sin\\theta\\,\\operatorname{sign}(\\cos\\theta)'}</Tex> 平均為 0，<Tex>{'E|\\cos\\theta|=\\frac1{2\\pi}\\int_0^{2\\pi}|\\cos\\theta|d\\theta=\\frac2\\pi'}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`|\delta_{k+1}|=|\delta_k|+\mu\,\frac{2A}{\pi}\,|\cos(\phi+\Omega D)|\quad(\cos(\phi+\Omega D)<0)`,
                why: (
                  <>
                    <Tex>{'\\delta_{k+1}=\\delta_k-\\mu G_k'}</Tex>，<Tex>{'G'}</Tex> 與 <Tex>{'\\delta'}</Tex> 反號時 <Tex>{'|\\delta|'}</Tex> 每 block 線性增加。
                  </>
                ),
              },
            ]}
          />
          <TexBlock id="F-06.15">{String.raw`G_k\to\operatorname{sign}(\delta_k)\,E[x_D\operatorname{sign}u],\qquad E[x_D\operatorname{sign}u]=\frac{2A}{\pi}\cos(\phi+\Omega D)`}</TexBlock>
          <p>
            T06 的參數（<Tex>{'A=1,\\;\\phi=120^\\circ,\\;\\mu=10\\,\\mathrm{fs}'}</Tex>）：等分布公式給{' '}
            <Tex>{`E[x\\operatorname{sign}u]=-\\tfrac1\\pi=${fx(large.formula, 4)}`}</Tex>，漂移{' '}
            <Tex>{`${fx(10 * Math.abs(large.formula), 3)}\\,\\mathrm{fs/block}`}</Tex>。但 <Tex>{'\\Omega=\\pi/6'}</Tex> 每 12 個 sample 重複一次，相位只取 12 個值，<strong>不是</strong>等分布；其中 <Tex>{'n\\equiv5,11\\pmod{12}'}</Tex> 兩個 sample 剛好落在 <Tex>{'u=0'}</Tex>{' '}
            的零交越（只剩雜訊，貢獻 0）。逐點加總：
          </p>
          <TexBlock>{String.raw`\frac1{12}\sum_{n=0}^{11}x[n]\operatorname{sign}(u[n])=\frac{-2\,(1+\tfrac{\sqrt3}{2}+\tfrac12-\tfrac12)}{12}=-\frac{2+\sqrt3}{12}=${fx(large.discrete, 4)}`}</TexBlock>
          <p>
            漂移 <Tex>{`${fx(10 * Math.abs(large.discrete), 3)}\\,\\mathrm{fs/block}`}</Tex>，與等分布公式只差約{' '}
            {fx((Math.abs(large.discrete / large.formula - 1) * 100), 1)}%。§7 閉迴路模擬在誤差變大後的實測斜率正是這個值（單元測試驗證到 <Tex>{'\\pm0.05\\,\\mathrm{fs/block}'}</Tex>）。所以 F-06.15 標{' '}
            <ClaimTag kind="approx" />：公式要求 <Tex>{'\\Omega/2\\pi'}</Tex> 為無理數或週期很長；實驗一律用時域 <code>empiricalLargeErrorGain()</code>
            （<Tex>{'u=0'}</Tex> 的 sample 視為 0 貢獻，不讓浮點捨入的正負號決定結果）。
          </p>
          <CodeBlock source={polaritySrc} region="largeErrorGain" path={PATH} />
        </StepBox>
      </ModeGate>

      <Quiz
        title="思考題 1（計算）"
        question={
          <>
            某設定 <Tex>{'C=-0.1'}</Tex>、<Tex>{'K_q=0.008\\,\\mathrm{fs}^{-1}'}</Tex>、<Tex>{'\\mu=20\\,\\mathrm{fs}'}</Tex>。工程師把 <Tex>{'\\mu'}</Tex> 減半，pole
            變成多少？還會發散嗎？
          </>
        }
        options={[
          { label: <><Tex>{`p=${fx(calPole(10, 0.008, 0.1), 3)}`}</Tex>，收斂</> },
          {
            label: (
              <>
                <Tex>{`p=${fx(calPole(10, 0.008, -0.1), 3)}`}</Tex>，仍發散，只是比 <Tex>{'\\mu=20'}</Tex> 時（<Tex>{`p=${fx(calPole(20, 0.008, -0.1), 3)}`}</Tex>）慢
              </>
            ),
            correct: true,
          },
          { label: <><Tex>{'p=1'}</Tex>，剛好臨界</> },
          { label: <><Tex>{`p=${fx(calPole(20, 0.008, 0.1), 3)}`}</Tex>，收斂而且更快</> },
        ]}
        answer={
          <>
            <TexBlock>{String.raw`p=1-\mu K_qC=1-10\times0.008\times(-0.1)=1+0.008=1.008>1`}</TexBlock>
            <p>
              原本 <Tex>{`\\mu=20:\\;p=${fx(calPole(20, 0.008, -0.1), 3)}`}</Tex>。減半只把每 block 的放大率從 1.6% 降到 0.8%，方向沒變，仍平均發散。選項 1、4 是把 <Tex>{'C'}</Tex> 的負號弄丟的結果。
            </p>
          </>
        }
      />
    </ChapterSection>
  )
}
