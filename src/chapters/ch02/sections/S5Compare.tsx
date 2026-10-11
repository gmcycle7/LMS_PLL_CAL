import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Prereq, Quiz, Section, StepDerivation, Tex, TexBlock } from '@/components'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import sgdSrc from '@/simulation/models/sgd.ts?raw'
import { equalSpeedVarianceRatio, noisePdfAt, type MeanFieldInput, type NoiseKind, type XKind } from '@/simulation/models/sgd'
import { ChapterLink, Diagram, ErrataNote, HandCalcSlot, f4, DerivFold, tm } from '../common'
import { SignLmsCompare } from '../experiments/SignLmsCompare'

const NOISES: NoiseKind[] = ['gaussian', 'laplacian', 'impulsive']
const NOISE_NAME: Record<string, string> = { gaussian: 'Gaussian', laplacian: 'Laplacian', impulsive: 'Impulsive（contaminated Gaussian）' }

/** §5 大比較表、核心程式碼並排、精度效率、NLMS 預告、主實驗。 */
export function S5Compare() {
  const eff = useMemo(() => {
    const inp = (noise: NoiseKind, x: XKind): MeanFieldInput => ({ a: 0, x: { kind: x, amp: 1 }, noise: { kind: noise, sigma: 1, outlierProb: 0, outlierSize: 0 }, huberDelta: 1, nlmsEps: 0.1 })
    return NOISES.map((n) => ({
      n,
      f0s: noisePdfAt({ kind: n, sigma: 1, outlierProb: 0, outlierSize: 0 }, 0),
      se: equalSpeedVarianceRatio('sign_error', inp(n, 'gauss')),
      ssG: equalSpeedVarianceRatio('sign_sign', inp(n, 'gauss')),
      ssB: equalSpeedVarianceRatio('sign_sign', inp(n, 'bpsk')),
      hub: equalSpeedVarianceRatio('huber', inp(n, 'gauss')),
      nlms: equalSpeedVarianceRatio('nlms', inp(n, 'gauss')),
    }))
  }, [])

  return (
    <section>
      <h2 id="ch02-s5">§5 演算法大比較：數學、硬體與程式碼</h2>

      <Section kind="diagram" title="先看地圖：每個演算法用了多少資訊、花多少硬體">
        <Diagram id="info-map">
          <p>
            {tm(
              String.raw`先看最上面一格：LMS 的誤差 $e$ 和輸入 $x$ 都用多位元——要 TDC 或 ADC 把誤差的大小量出來，還要一個乘法器。再沿著實線往下看：先丟掉誤差的大小、只留 1 bit，就是 Sign-Error（TDC 換成一顆 comparator，乘法器換成條件取負）；再丟掉輸入的大小，就是 Sign-Sign（只剩 XOR 和計數器）。越往下硬體越省，但每丟掉一種資訊，收斂到的點與穩態的抖動都會跟著改變——下面的總比較表逐欄列出。虛線那條路（先丟掉輸入的大小、保留多位元誤差，叫做 signed-regressor LMS）本章不討論。`,
            )}
          </p>
          <p>圖上每一格的第二行，就是下面總比較表裡「需要的 error 位元」與「需要的 regressor 位元」兩欄；第三行是「硬體成本」那一欄。</p>
        </Diagram>
      </Section>

      <Section kind="example" title="總比較表">
        <div className="table-wrap">
          <table className="ch02-table ch02-big-table">
            <thead>
              <tr>
                <th>演算法</th>
                <th>
                  更新量 <Tex>{'\\Delta w'}</Tex>
                </th>
                <th>需要的 error 位元</th>
                <th>需要的 regressor 位元</th>
                <th>目標（純量）</th>
                <th>固定點條件</th>
                <th>純量固定點（比值觀點）</th>
                <th>
                  固定 <Tex>{'\\mu'}</Tex> 的穩態行為
                </th>
                <th>硬體成本</th>
                <th>對 outlier</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>LMS</td>
                <td>
                  <Tex>{'\\mu\\,e\\,x'}</Tex>
                </td>
                <td>多位元（TDC / ADC）</td>
                <td>多位元</td>
                <td>
                  <Tex>{'\\tfrac12E[e^2]'}</Tex>
                </td>
                <td>
                  <Tex>{'E[e\\,x]=0'}</Tex>
                </td>
                <td>
                  <Tex>{'x^2'}</Tex> 加權平均
                </td>
                <td>
                  指數收斂後在 <Tex>{'w^*'}</Tex> 附近抖動，<Tex>{String.raw`\operatorname{Var}\approx\mu\sigma_v^2/2`}</Tex>；步長太大會發散（固定 <Tex>{'x'}</Tex>：<Tex>{'\\mu<2/x^2'}</Tex>；隨機 <Tex>{'x'}</Tex> 的 mean／mean-square 界見 Ch03）
                </td>
                <td>乘法器 <Tex>{'B_e\\times B_x'}</Tex> + 累加器</td>
                <td>敏感（平方放大）</td>
              </tr>
              <tr>
                <td>Sign-Error</td>
                <td>
                  <Tex>{'\\mu\\operatorname{sign}(e)\\,x'}</Tex>
                </td>
                <td>
                  <strong>1 bit</strong>（comparator / BBPD）
                </td>
                <td>多位元</td>
                <td>
                  <Tex>{'E|e|'}</Tex>
                </td>
                <td>
                  <Tex>{'E[\\operatorname{sign}(e)\\,x]=0'}</Tex>
                </td>
                <td>
                  <Tex>{'|x|'}</Tex> 加權中位數
                </td>
                <td>
                  遠處等速前進；近處 <Tex>{'\\pm\\mu|x|'}</Tex> limit cycle（無雜訊）或 <Tex>{String.raw`\operatorname{Var}\approx\mu/(4f_v(0))`}</Tex>（有雜訊、小步長）；不會指數發散
                </td>
                <td>
                  <strong>條件取負</strong>（MUX + 2&apos;s complement）+ 累加器，無乘法器
                </td>
                <td>強健（只看正負號）</td>
              </tr>
              <tr>
                <td>Sign-Sign</td>
                <td>
                  <Tex>{'\\mu\\operatorname{sign}(e)\\operatorname{sign}(x)'}</Tex>
                </td>
                <td>1 bit</td>
                <td>
                  <strong>1 bit</strong>
                </td>
                <td>
                  <Tex>{'E[|e|/|x|]=E|r-w|'}</Tex>
                </td>
                <td>
                  <Tex>{'E[\\operatorname{sign}(e)\\operatorname{sign}(x)]=0'}</Tex>
                </td>
                <td>不加權中位數（與 Sign-Error 不同）</td>
                <td>
                  每步固定 <Tex>{'\\pm\\mu'}</Tex>；同上的 limit cycle；多參數時無「下山」保證
                </td>
                <td>
                  <strong>XOR + up/down counter</strong>（最便宜）
                </td>
                <td>強健</td>
              </tr>
              <tr>
                <td>Huber</td>
                <td>
                  <Tex>{'\\mu\\,\\psi_{\\rm H}(e)\\,x'}</Tex>
                </td>
                <td>
                  多位元但可飽和（<Tex>{'\\psi_{\\rm H}'}</Tex>：clip 到 <Tex>{'\\pm\\delta_{\\rm H}'}</Tex>）
                </td>
                <td>多位元</td>
                <td>Huber loss</td>
                <td>
                  <Tex>{'E[\\psi_{\\rm H}(e)\\,x]=0'}</Tex>
                </td>
                <td>介於平均與中位數</td>
                <td>
                  小誤差像 LMS、大誤差像 Sign-Error（每步最多 <Tex>{'\\mu\\delta_{\\rm H}|x|'}</Tex>，不會發散）
                </td>
                <td>
                  乘法器 + 飽和器（<Tex>{'e'}</Tex> 的位寬可以很窄）
                </td>
                <td>強健（大誤差被截斷）</td>
              </tr>
              <tr>
                <td>NLMS</td>
                <td>
                  <Tex>{'\\tilde\\mu\\,e\\,x/(\\varepsilon+x^2)'}</Tex>
                </td>
                <td>多位元</td>
                <td>多位元</td>
                <td>
                  <Tex>{'\\approx\\tfrac12E[(r-w)^2]'}</Tex>
                </td>
                <td>
                  <Tex>{'E[e\\,x/(\\varepsilon+x^2)]=0'}</Tex>
                </td>
                <td>近似不加權平均</td>
                <td>
                  <Tex>{'0<\\tilde\\mu<2'}</Tex> 對任何 <Tex>{'x'}</Tex> 幅度都穩定；小 <Tex>{'|x|'}</Tex> 時雜訊被放大
                </td>
                <td>乘法器 + 除法器（或 LUT）</td>
                <td>敏感</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="ch02-note">
          穩態公式為小步長線性化 <ClaimTag kind="approx" />；固定點條件與比值觀點為純量模型的精確結果 <ClaimTag kind="exact" />。表格在手機上可水平捲動，第一欄固定。
        </p>
      </Section>

      <Section kind="formula" title="核心程式碼並排（網站實際執行的就是這幾段）">
        <CodeCompare
          items={[
            { label: 'LMS', source: lmsSrc, region: 'conventionalStep', path: 'src/simulation/models/lms.ts', note: '用到 $e$ 的大小：需要多位元 error 與乘法器' },
            { label: 'Sign-Error', source: lmsSrc, region: 'signErrorStep', path: 'src/simulation/models/lms.ts', note: String.raw`只用 $\operatorname{sign}(e)$：1-bit comparator 就夠` },
            { label: 'Sign-Sign', source: lmsSrc, region: 'signSignStep', path: 'src/simulation/models/lms.ts', note: '$x$ 也只剩正負號：XOR + 計數器' },
          ]}
          caption="三段只差標「← 差異」的那一行；其他行（算誤差 $e=y-wx$、回傳 $w+\Delta w$）完全相同。"
        />
        <CodeCompare
          items={[
            { label: 'Huber', source: lmsSrc, region: 'huberStep', path: 'src/simulation/models/lms.ts', note: String.raw`小誤差用 $e$、大誤差截成 $\pm\delta_{\rm H}$（介於 LMS 與 Sign-Error）` },
            { label: 'NLMS', source: sgdSrc, region: 'nlmsStep', path: 'src/simulation/models/sgd.ts', note: String.raw`步長除以 $\varepsilon+x^2$：尺度不變` },
          ]}
          caption="另外兩個變體：lms.ts 的第四個 stepper（Huber）與本章 sgd.ts 的 NLMS。"
        />
        <ModeGate min="engineer">
          <CodeBlock source={sgdSrc} region="runShared" path="src/simulation/models/sgd.ts" title="主實驗：同一組資料、逐一換 stepper" />
          <CodeBlock source={sgdSrc} region="sharedData" path="src/simulation/models/sgd.ts" />
          <CodeBlock source={sgdSrc} region="noiseSampler" path="src/simulation/models/sgd.ts" />
        </ModeGate>
      </Section>

      <Section kind="diagram" title="硬體資料路徑：乘法器 vs 條件取負 vs XOR">
        <Diagram id="datapath">
          <p>
            {tm(
              String.raw`先看每一排上色的那一格：LMS 是紅色的多位元乘法器（$B_e$、$B_x$ 是誤差與輸入的位元數，乘法器的面積大約正比於 $B_e\times B_x$）；Sign-Error 是藍色的 MUX，只是在「加 $x$」與「減 $x$」之間二選一；Sign-Sign 是綠色的 XOR。再看每一排的最後一格：LMS 與 Sign-Error 都還要用多位元的加法器，把移位後的結果加進 $w$；Sign-Sign 只要一個上下數的計數器。`,
            )}
          </p>
          <p>{tm(String.raw`圖上的三排（LMS、Sign-Error、Sign-Sign）各自對應上面並排的三段程式碼裡標「← 差異」的那一行：$\mu\,e\,x$、$\mu\operatorname{sign}(e)\,x$、$\mu\operatorname{sign}(e)\operatorname{sign}(x)$。`)}</p>
        </Diagram>
        <p>
          Sign-Error 的 <Tex>{'\\operatorname{sign}(e)\\,x'}</Tex> 在硬體上是「<strong>conditional negation</strong>」：<Tex>{'q=+1'}</Tex> 時加 <Tex>{'x'}</Tex>、<Tex>{'q=-1'}</Tex> 時減 <Tex>{'x'}</Tex>
          （2&apos;s complement：XOR 每個位元再進位 1）。這就是 PLL 校正中 GMAC 的乘加單元（<ChapterLink ch="04">Ch04</ChapterLink>）。
          若 comparator 輸出 0/1，必須先映射 <Tex>{'q=2b-1'}</Tex>，否則等於用了錯的 regressor（Ch05、Ch11）。
        </p>
      </Section>

      <Section kind="formula" title="精度效率：同收斂速度下誰比較準？">
        <p>
          收斂之後，<Tex>{'w'}</Tex> 並不會靜止，而是在固定點附近抖動。抖多大？靠近固定點時，四種演算法都可以畫成同一個一階迴路，只差兩個數字：
        </p>
        <Diagram id="noise-loop">
          <p>
            {tm(
              String.raw`先看藍色的方塊：靠近固定點時，每一步參數誤差 $\delta[n]$ 都被乘上 pole $p=1-\mu K$，其中 $K$ 是平均更新方向在固定點的斜率（每單位步長的 loop gain；LMS 的 $K=E[x^2]$，Sign-Error 的 $K=K_{\rm SE}$）。再看紅色的輸入：每一步還有一筆隨機的梯度雜訊 $\eta[n]$（單步更新方向偏離平均的部分，變異 $\sigma_\eta^2$），乘上 $\mu$ 之後注入迴路。這是一個一階低通：$\mu K$ 越小，pole 越靠近 1，每筆雜訊進來得越少、被平均得越久，抖動越小——但修掉誤差也越慢（時間常數 $\tau\approx1/(\mu K)$ 步）。`,
            )}
          </p>
          <p>
            {tm(
              String.raw`圖上加法點的兩個輸入，就是下面推導第一行等號右邊的兩項 $(1-\mu K)\,\delta_n$ 與 $\mu\,\eta_n$。$\eta_n$ 平均為 0，它的正負號怎麼定義不影響結果；進到 F-02.13 的只有它的變異 $\sigma_\eta^2$。兩個演算法要公平比較，就讓 $g=\mu K$（正規化 loop gain）相同，再比誰的 $\sigma_\eta^2/K^2$ 小——兩者相除就是 F-02.14 的變異比。`,
            )}
          </p>
        </Diagram>
        <DerivFold>
          <StepDerivation
            steps={[
              { tex: String.raw`\delta_{n+1}\approx(1-\mu K)\,\delta_n+\mu\,\eta_n`, why: tm('靠近 $w^*$ 的線性化（$K$：斜率，$\\eta$：梯度雜訊，$\\operatorname{Var}\\eta=\\sigma_\\eta^2$）') },
              { tex: String.raw`V_{n+1}\equiv E[\delta_{n+1}^2]=(1-\mu K)^2V_n+\mu^2\sigma_\eta^2`, why: tm('平方後取期望；交叉項 $E[\\delta_n\\eta_n]=0$（$\\eta_n$ 零均值、與 $\\delta_n$ 獨立）') },
              { tex: String.raw`V_\infty=(1-\mu K)^2V_\infty+\mu^2\sigma_\eta^2`, why: tm('穩態：$V_{n+1}=V_n=V_\\infty$（需要 $|1-\\mu K|<1$）') },
              { tex: String.raw`V_\infty=\frac{\mu^2\sigma_\eta^2}{1-(1-\mu K)^2}=\frac{\mu\sigma_\eta^2}{K(2-\mu K)}\approx\frac{\mu\sigma_\eta^2}{2K}`, why: tm('移項；$1-(1-g)^2=g(2-g)$；最後一步用小 $\\mu K$') },
              { tex: String.raw`\mu K=g\ \text{固定（同速度）}\;\Rightarrow\;\operatorname{Var}\approx\frac{g}{2}\cdot\frac{\sigma_\eta^2}{K^2}`, why: tm('時間常數 $\\tau\\approx1/(\\mu K)$：公平比較要讓 $\\mu K$ 相同') },
              { tex: String.raw`\text{LMS: }K=P_x,\ \sigma_\eta^2=\sigma_v^2P_x\;\Rightarrow\;\frac{\sigma_\eta^2}{K^2}=\frac{\sigma_v^2}{P_x}`, why: tm('§2：$\\psi_{\\rm LMS}=P_x\\,d$，谷底的梯度雜訊變異 $\\sigma_v^2P_x$') },
              { tex: String.raw`\text{SE: }K=2f_v(0)P_x,\ \sigma_\eta^2=E[\operatorname{sign}^2(e)x^2]=P_x\;\Rightarrow\;\frac{\sigma_\eta^2}{K^2}=\frac{1}{4f_v(0)^2P_x}`, why: tm('$\\operatorname{sign}^2=1$：梯度雜訊與雜訊大小無關') },
              { tex: String.raw`\frac{\operatorname{Var}_{\rm SE}}{\operatorname{Var}_{\rm LMS}}=\frac{1}{4f_v(0)^2\sigma_v^2}`, why: tm('相除，$P_x$ 消掉') },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.13">{String.raw`\operatorname{Var}(w)\approx\frac{\mu\,\sigma_\eta^2}{K(2-\mu K)}\qquad(0<\mu K<2,\ \text{小步長；sign 類另需 }\mu x^2\ll\sigma_v\text{，即 }\mu K\ll1)`}</TexBlock>
        <p className="ch02-note" data-linearization-validity>
          sign 類的「小步長」要在 comparator 輸入端比：走一步 <Tex>{'\\Delta w=\\pm\\mu x'}</Tex> 會讓誤差 <Tex>{'e=(a-w)x+v'}</Tex> 改變 <Tex>{'\\mu x^2'}</Tex>，
          它必須遠小於雜訊 <Tex>{'\\sigma_v'}</Tex>，雜訊才來得及把 sign 平滑成斜線（<Tex>{'|x|=1'}</Tex> 時才會和帶寬 <Tex>{'\\mu|x|'}</Tex> 是同一個數）。
          用 <Tex>{'K_{\\rm SE}=K_qE[x^2]'}</Tex> 改寫就是 <Tex>{'g=\\mu K_{\\rm SE}\\ll1'}</Tex>。Gaussian 雜訊、<Tex>{'x=\\pm A'}</Tex> 的 Monte Carlo 對照：
          <Tex>{'g=0.1'}</Tex> 時公式高估 <Tex>{'\\sigma_w'}</Tex> 不到 1%、<Tex>{'g=0.2'}</Tex> 約 1.5%、<Tex>{'g=0.5'}</Tex> 約 5%、<Tex>{'g=1'}</Tex> 約 18%（手算題 HC-02.8 只接受 <Tex>{'g\\le0.5'}</Tex>）。
        </p>
        <TexBlock id="F-02.14">{String.raw`\boxed{\frac{\operatorname{Var}_{\rm SE}}{\operatorname{Var}_{\rm LMS}}\bigg|_{\text{同 }\mu K}=\frac{1}{4f_v(0)^2\sigma_v^2}=\begin{cases}\pi/2\approx1.571&\text{Gaussian: }f_v(0)=\frac{1}{\sqrt{2\pi}\sigma_v}\\[2pt]1/2&\text{Laplacian: }f_v(0)=\frac{1}{\sqrt2\,\sigma_v}\end{cases}}`}</TexBlock>
        <p>
          <ClaimTag kind="approx" /> 這就是統計學「中位數 vs 平均」的漸近效率：Gaussian 雜訊下用 sign 會多付 57% 的變異（std 多 25%）；
          雜訊尾巴越重（Laplacian、impulsive），sign 反而越準。下表由 <code>equalSpeedVarianceRatio()</code> 數值計算（<Tex>{'\\sigma_v=1'}</Tex>）：
        </p>
        <div className="table-wrap">
          <table className="ch02-table">
            <thead>
              <tr>
                <th>雜訊</th>
                <th className="num">
                  <Tex>{'f_v(0)\\sigma_v'}</Tex>
                </th>
                <th className="num">SE / LMS 變異比</th>
                <th className="num">{tm('SS / LMS（Gaussian $x$）')}</th>
                <th className="num">{tm('SS / LMS（$x=\\pm1$）')}</th>
                <th className="num">{tm('Huber（$\\delta_{\\rm H}=\\sigma_v$）/ LMS')}</th>
                <th className="num">{tm('NLMS（$\\varepsilon=0.1$）/ LMS')}</th>
              </tr>
            </thead>
            <tbody>
              {eff.map((r) => (
                <tr key={r.n}>
                  <td>{NOISE_NAME[r.n]}</td>
                  <td className="num">{f4(r.f0s)}</td>
                  <td className="num">{f4(r.se)}</td>
                  <td className="num">{f4(r.ssG)}</td>
                  <td className="num">{f4(r.ssB)}</td>
                  <td className="num">{f4(r.hub)}</td>
                  <td className="num">{f4(r.nlms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ch02-note">
          Sign-Sign 再多付 <Tex>{'E[x^2]/(E|x|)^2'}</Tex>（Gaussian <Tex>{'x'}</Tex> 為 <Tex>{'\\pi/2'}</Tex>，<Tex>{'\\pm1'}</Tex> 的 <Tex>{'x'}</Tex> 為 1：幅度固定時 SS 與 SE 相同）。NLMS 在 Gaussian <Tex>{'x'}</Tex> 下較差，因為小 <Tex>{'|x|'}</Tex> 的樣本比值 <Tex>{'r=a+v/x'}</Tex> 雜訊很大，卻得到幾乎相同的權重。
        </p>
      </Section>

      <Section kind="formula" title="NLMS 預告：把步長正規化">
        <p>
          LMS 的穩定界 <Tex>{'\\mu<2/x^2'}</Tex> 依賴輸入幅度：code 幅度因 PVT 或 FCW 改變 10 倍時，同一個 <Tex>{'\\mu'}</Tex> 可能發散或慢 100 倍。§1 說最好的步長是 <Tex>{"1/J''=1/x^2"}</Tex>——那就每一步都除以 <Tex>{'x_n^2'}</Tex>：
        </p>
        <Diagram id="nlms-datapath">
          <p>
            {tm(
              String.raw`先看 LMS 那一框：更新量 $\mu\,e\,x$ 裡的 $e$ 本身也正比於 $x$，所以輸入變大 10 倍，每一步就大 100 倍。再看 NLMS 那一框裡藍色的兩格：它多算一個 $x[n]^2$，用它去除更新量（$\varepsilon$ 是避免除以零的小常數），於是每一步修掉的誤差比例和 $x$ 的大小無關。$\tilde\mu$ 是除過之後的步長，沒有單位。`,
            )}
          </p>
          <p>{tm(String.raw`圖上的「$\div(\varepsilon+x[n]^2)$」就是 F-02.15 的分母，「$\times\tilde\mu$」就是分子上的 $\tilde\mu$；LMS 那一框和 §2 的迴圈相同。`)}</p>
        </Diagram>
        <DerivFold>
          <StepDerivation
            steps={[
              { tex: String.raw`e^+\equiv y-w_{n+1}x=y-(w_n+\mu e\,x)x=e\,(1-\mu x^2)`, why: '更新後同一筆資料的誤差（a posteriori error）' },
              { tex: String.raw`\mu=\frac{\tilde\mu}{x^2}\;\Rightarrow\;e^+=(1-\tilde\mu)\,e`, why: tm('用目前輸入的功率正規化：結果與 $x$ 的大小無關') },
              { tex: String.raw`|1-\tilde\mu|<1\iff0<\tilde\mu<2`, why: tm('對任何 $x$ 幅度都成立（尺度不變）') },
              { tex: String.raw`w_{n+1}=w_n+\frac{\tilde\mu}{\varepsilon+x_n^2}\,e_nx_n`, why: tm('加上 $\\varepsilon>0$：避免 $x\\approx0$ 時除以零，也限制雜訊被 $1/x$ 放大') },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.15">{String.raw`\boxed{w_{n+1}=w_n+\frac{\tilde\mu}{\varepsilon+x_n^2}\,e_nx_n,\qquad0<\tilde\mu<2}`}</TexBlock>
        <p>
          <ClaimTag kind="exact" />（固定 <Tex>{'x'}</Tex>、<Tex>{'\\varepsilon=0'}</Tex> 時的 pole 為 <Tex>{'1-\\tilde\\mu'}</Tex>）。多參數時分母變成 <Tex>{'\\varepsilon+\\|\\mathbf x\\|^2'}</Tex>；更一般的「用曲率／相關矩陣正規化」就是
          <ChapterLink ch="10">Ch10</ChapterLink> 的 preconditioner。注意 NLMS 需要多位元的 <Tex>{'e'}</Tex> 與除法，它不是 1-bit 校正的替代品，而是告訴我們「步長應該跟著 regressor 功率走」。
        </p>
        <HandCalcSlot id="HC-02.7">
          用你自己的 <Tex>{'w,\\ x,\\ y,\\ \\tilde\\mu,\\ \\varepsilon'}</Tex> 算一步 NLMS，並親手驗證 <Tex>{'e^+=(1-\\tilde\\mu)\\,e'}</Tex>（<Tex>{'\\varepsilon=0'}</Tex>）；
          再把 <Tex>{'x'}</Tex>、<Tex>{'y'}</Tex> 同乘 10 重算，看收縮比例是不是不變。
        </HandCalcSlot>
        <ModeGate min="engineer">
          <CodeBlock source={sgdSrc} region="nlmsStep" path="src/simulation/models/sgd.ts" />
        </ModeGate>
      </Section>

      <Section kind="explore" title="主實驗：同一組資料上的四種演算法">
        <Prereq title="Monte Carlo、中位數／分位數與 95% 信賴區間（讀懂下方表格）">
          <ul>
            <li>
              <strong>Monte Carlo</strong>：用 <Tex>{'R'}</Tex> 個不同的 seed 各跑一次完整模擬，把「期望值」換成 <Tex>{String.raw`R`}</Tex> 次結果的平均
              <Tex>{String.raw`\bar w=\frac1R\sum_{r=1}^{R}w^{(r)}`}</Tex>。同一個 seed 一定得到同一條路徑（可重現）。
            </li>
            <li>
              <strong>標準誤（SE）與 95% 信賴區間</strong>：<Tex>{String.raw`R`}</Tex> 個獨立樣本平均的標準差是 <Tex>{String.raw`s/\sqrt R`}</Tex>（<Tex>{'s'}</Tex>：樣本標準差）。
              中央極限定理說平均近似 Gaussian，所以 <Tex>{String.raw`\bar w\pm t_{0.975}\,s/\sqrt R`}</Tex>（<Tex>{String.raw`R`}</Tex> 大時 <Tex>{String.raw`t_{0.975}\approx1.96`}</Tex>）約有 95% 機率涵蓋真值。
              表格的「一致」用 <Tex>{String.raw`4\,\mathrm{SE}`}</Tex> 再加上 <Tex>{String.raw`O(\mu)`}</Tex> 修正當容差。
            </li>
            <li>
              <strong>中位數與 10% / 90% 分位數</strong>：把 <Tex>{String.raw`R`}</Tex> 個 <Tex>{String.raw`|\delta_n|`}</Tex> 排序，取第 50%、10%、90% 位置的值。
              它們不受少數極端路徑影響；<Tex>{String.raw`E[\delta^2]`}</Tex> 的樣本平均可能被一兩條重尾路徑主導，所以收斂圖畫分位數 <ErrataNote id="E14" />。
            </li>
          </ul>
        </Prereq>
        <SignLmsCompare />
        <ModeGate min="engineer">
          <CodeBlock source={sgdSrc} region="monteCarlo" path="src/simulation/models/sgd.ts" title="表格的 Monte Carlo（在 Web Worker 執行）" />
          <CodeBlock source={sgdSrc} region="steadyState" path="src/simulation/models/sgd.ts" title="表格的「穩態 std（預測）」" />
        </ModeGate>
      </Section>

      <Callout kind="warn" title="注意假設">
        <ul className="ch02-try">
          <li>本章的 <Tex>{'x'}</Tex> 與 <Tex>{'v'}</Tex> 都是 iid、彼此獨立；PLL 中的有效 regressor <Tex>{'u=h*x'}</Tex> 有時間相關，公式要改用 Ch06–Ch07 的相關函數。</li>
          <li>「固定點」是 mean-field（平均更新為零）的點；固定步長時真正的穩態平均還有 <Tex>{'O(\\mu)'}</Tex> 的偏移（實驗中以 <Tex>{"\\psi''\\operatorname{Var}/(2K)"}</Tex> 修正）。</li>
          <li>
            <Tex>{'\\operatorname{sign}(0)'}</Tex> 的慣例與浮點捨入會造成 <Tex>{'O(\\mu)'}</Tex> 的差異 <ErrataNote id="E40" />；硬體的有限位寬（量化、limit cycle）在 Ch13。
          </li>
        </ul>
      </Callout>

      <Quiz
        title="思考題 5（選演算法）"
        question={<>comparator 前的雜訊有明顯的 impulsive 成分（偶發大突波），硬體也只有 1-bit comparator。同收斂速度下，Sign-Error 與（假想的）多位元 LMS 誰的穩態抖動小？</>}
        options={[{ label: 'LMS，因為它用了更多資訊' }, { label: tm('Sign-Error，因為 $f_v(0)\\sigma_v$ 大、變異比 $<1$'), correct: true }, { label: '一樣' }]}
        answer={
          <>
            變異比 <Tex>{'1/(4f_v(0)^2\\sigma_v^2)'}</Tex>：impulsive 雜訊的 <Tex>{'\\sigma_v'}</Tex> 被少數大突波撐大，但中心的密度 <Tex>{'f_v(0)'}</Tex> 很高，比值約 {f4(eff[2]?.se ?? NaN, 3)}——Sign-Error 的 std 只有 LMS 的約
            {f4(Math.sqrt(eff[2]?.se ?? NaN), 3)} 倍。「用更多 bit」不等於更準：平方誤差讓突波主導了更新。
          </>
        }
      />
    </section>
  )
}
