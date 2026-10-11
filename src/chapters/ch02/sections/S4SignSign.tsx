import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, Derivation, ModeGate, Plot, Prereq, Quiz, Section, SourceTag, StepDerivation, Tex, TexBlock, useThemeTokens } from '@/components'
import sgdSrc from '@/simulation/models/sgd.ts?raw'
import { meanFieldAnalysis, meanFieldDrift, noiseOps, ratioFixedPoints, xMoments, type MeanFieldInput, type XKind } from '@/simulation/models/sgd'
import { ALGO_SERIES, ChapterLink, Diagram, ErrataNote, HandCalcSlot, f4, range, DerivFold, tm } from '../common'
import { FixedPointExplorer } from '../experiments/FixedPointExplorer'

const XS = [1, 2, 4]
const YS = [3, 7, 10]

/** §4 Sign-Sign LMS：不是 Sign-Error 的簡化版。 */
export function S4SignSign() {
  const tokens = useThemeTokens()
  const rf = useMemo(() => ratioFixedPoints(XS, YS), [])
  // Ch01 / 規格 §2.3 的例子：y = [0, 0, 0, 10]、x ≡ 1（比值就是 y 本身）
  const dc = useMemo(() => ratioFixedPoints([1, 1, 1, 1], [0, 0, 0, 10]), [])
  const costPlot = useMemo<Data[]>(() => {
    const ws = range(301).map((i) => 2 + (2 * i) / 300)
    const norm = (v: number[]) => {
      const lo = Math.min(...v)
      const hi = Math.max(...v)
      return v.map((u) => (u - lo) / (hi - lo))
    }
    const jL = ws.map((w) => XS.reduce((s, x, i) => s + 0.5 * (YS[i] - w * x) ** 2, 0))
    const jE = ws.map((w) => XS.reduce((s, x, i) => s + Math.abs(YS[i] - w * x), 0))
    const jS = ws.map((w) => XS.reduce((s, x, i) => s + Math.abs(YS[i] / x - w), 0))
    return [
      { x: ws, y: norm(jL), name: 'LMS：Σ½(y − wx)²', mode: 'lines', line: { color: tokens.series[ALGO_SERIES.lms] } },
      { x: ws, y: norm(jE), name: 'Sign-Error：Σ|y − wx|', mode: 'lines', line: { color: tokens.series[ALGO_SERIES.sign_error] } },
      { x: ws, y: norm(jS), name: 'Sign-Sign：Σ|y/x − w|', mode: 'lines', line: { color: tokens.series[ALGO_SERIES.sign_sign] } },
      {
        x: [rf.lms, rf.signError[0], rf.signSign[0]],
        y: [0, 0, 0],
        name: '最小值',
        mode: 'markers',
        marker: { size: 10, symbol: 'diamond', color: [tokens.series[ALGO_SERIES.lms], tokens.series[ALGO_SERIES.sign_error], tokens.series[ALGO_SERIES.sign_sign]] },
      },
    ]
  }, [rf, tokens])

  // 偏斜雜訊：x ≡ 1 與 x ~ U[0.5, 1.5]（mean-field 精確積分）
  const skew = useMemo(() => {
    const mk = (kind: XKind): MeanFieldInput => ({ a: 3, x: { kind, amp: 1 }, noise: { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 }, huberDelta: 0.5, nlmsEps: 0.1 })
    return (['const', 'uniformPos', 'bpsk'] as XKind[]).map((k) => ({
      kind: k,
      ex: xMoments(mk(k).x).m1,
      psiSe: meanFieldDrift('sign_error', 3, mk(k)), // ψ_SE(a)：F-02.18 預測 = E[sign v]·E[x]
      lms: meanFieldAnalysis('lms', mk(k)).wStar,
      se: meanFieldAnalysis('sign_error', mk(k)).wStar,
      ss: meanFieldAnalysis('sign_sign', mk(k)).wStar,
    }))
  }, [])
  // 偏斜雜訊的 E[sign v] = 1 − 2F_v(0) = 2/e − 1（σ 不影響）
  const signV = useMemo(() => noiseOps({ kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 }).signMean(0), [])
  const X_LABEL: Record<string, string> = { const: String.raw`x\equiv1`, uniformPos: String.raw`x\sim U[0.5,\,1.5]`, bpsk: String.raw`x=\pm1` }

  return (
    <section>
      <h2 id="ch02-s4">§4 Sign-Sign LMS：連 regressor 的幅度也丟掉</h2>

      <Section kind="intuition" title="最便宜的硬體">
        <p>
          Sign-Error 已經把誤差壓成 1 bit，但每一步還是要加或減一個多位元的 <Tex>{'x'}</Tex>。能不能連 <Tex>{'x'}</Tex> 也只留正負號？先看迴路會變成什麼樣子：
        </p>
        <Diagram id="sign-sign-loop">
          <p>
            {tm(
              String.raw`先看藍色的方塊：和 §3 的迴圈相比，輸入 $x[n]$ 進更新器之前也多通過一個 $\operatorname{sign}(\cdot)$，只剩正負號。再看 XOR：兩個 1-bit 的正負號相乘只有兩種結果（同號得 $+1$、異號得 $-1$），硬體上就是一個 XOR 閘。最後看計數器：每一步只會加 $\mu$ 或減 $\mu$，所以整個更新器只是一個上下數的計數器——它同時扮演了前面圖裡的「$\times\mu$」、累加與 $z^{-1}$。`,
            )}
          </p>
          <p>{tm(String.raw`圖上 XOR 的兩個輸入 $\operatorname{sign}(e[n])$、$\operatorname{sign}(x[n])$ 就是下面 F-02.7 裡相乘的兩項；計數器裡的 $\pm\mu$ 就是 $\mu$ 乘上它們的乘積。`)}</p>
        </Diagram>
        <TexBlock id="F-02.7">{String.raw`\boxed{w_{n+1}=w_n+\mu\,\operatorname{sign}(e_n)\,\operatorname{sign}(x_n)}`}</TexBlock>
        <p>
          每一步只有 <Tex>{'\\pm\\mu'}</Tex>：一個 XOR 決定往上或往下數，一個 up/down counter 就是整個更新器。規格 §2.3 寫「連 Regressor 幅度也丟掉，別和 Sign-Error 混淆」
          <ErrataNote id="E43">原文拼成 Regessor</ErrataNote>。它常被當成 Sign-Error 的「再簡化版」，但這是誤解：
          <strong>它最小化的是另一個成本，收斂到另一個點。</strong>
        </p>
        <HandCalcSlot id="HC-02.4">
          到這裡三個更新式都出現了：LMS（F-02.5）、Sign-Error（F-02.6）、Sign-Sign（F-02.7）。用同一組 <Tex>{'w,\\ x,\\ y,\\ \\mu'}</Tex> 各走一步，
          先自己算出三個新的 <Tex>{'w'}</Tex> 再對答案——特別試試負的 <Tex>{'x'}</Tex> 和 <Tex>{'|x|\\neq1'}</Tex>，才看得出三者的差別。
        </HandCalcSlot>
      </Section>

      <Section kind="formula" title={tm('比值觀點：四種演算法其實都在估計 $r=y/x$ 的「中心」')}>
        <Prereq title="平均 vs 中位數：哪一個「中心」讓哪一種誤差最小？">
          <p>給一組數字 <Tex>{'r_1,\\ldots,r_N'}</Tex> 與正權重 <Tex>{'c_i'}</Tex>，把「中心」<Tex>{'m'}</Tex> 當成變數，用微分找最小值：</p>
          <StepDerivation
            steps={[
              { tex: String.raw`\frac{d}{dm}\sum_i c_i\,\tfrac12(r_i-m)^2=-\sum_i c_i(r_i-m)=0\;\Rightarrow\;m=\frac{\sum c_ir_i}{\sum c_i}`, why: tm('平方誤差：導數是線性的，零點就是「加權平均」') },
              { tex: String.raw`\frac{d}{dm}\sum_i c_i\,|r_i-m|=-\sum_i c_i\operatorname{sign}(r_i-m)`, why: tm('絕對誤差：每一項的斜率只有 $\\pm c_i$（§3 的次梯度）') },
              { tex: String.raw`=-\Big(\sum_{r_i>m}c_i-\sum_{r_i<m}c_i\Big)=0`, why: tm('比 $m$ 大的權重和 = 比 $m$ 小的權重和') },
              { tex: String.raw`\Rightarrow\;m=\text{加權中位數：累積權重第一次超過 }\tfrac12\textstyle\sum c_i\text{ 的那一點}`, why: tm('把 $r_i$ 排序後累加權重；剛好等於一半時，中間整段區間都是最小值') },
            ]}
          />
          <p>
            所以「平均」只看數值的大小（一個 outlier 就能把它拉走），「中位數」只看排序（outlier 再大也只算一票）。<Tex>{'c_i\\equiv1'}</Tex> 時就是一般的平均與中位數。
          </p>
          <p>
            先算一次（Ch01 的例子）：<Tex>{String.raw`r=\{0,\,0,\,0,\,10\}`}</Tex>、權重都是 1。平均 <Tex>{String.raw`(0+0+0+10)/4=${f4(dc.lms)}`}</Tex>；
            中位數：比 <Tex>{'m=0'}</Tex> 大的只有 1 票、不比它大的有 3 票，所以 <Tex>{String.raw`m=${f4(dc.signSign[0])}`}</Tex>。把那個 10 換成 1000，平均變成 250，中位數還是 0。
          </p>
        </Prereq>
        <p>
          有了「平均」與「中位數」這兩種中心，就可以用同一張圖看懂四種演算法各自收斂到哪裡。這裡順便把 §5 才正式介紹的 NLMS（normalized LMS）也放進來：
          它把 LMS 的更新量除以 <Tex>{'\\varepsilon+x^2'}</Tex>（<Tex>{'\\varepsilon'}</Tex> 是避免除以零的小常數，這裡先取 <Tex>{'\\varepsilon=0'}</Tex>）。
        </p>
        <Diagram id="ratio-view">
          <p>
            {tm(
              String.raw`先看左邊兩格：每一筆資料自己就能給出一個 $a$ 的估計——比值 $r[i]=y[i]/x[i]$。因為 $y=a\,x+v$，這個估計等於 $a$ 加上被 $1/x$ 放大的雜訊：$|x|$ 越小的那一筆越不準。再看右邊四格：四種演算法收斂到的點，都是這一堆比值的某種「中心」——藍色兩格取平均（一個 outlier 就能把它拉走），綠色兩格取中位數（只看排序）。同一種顏色裡的差別只在每一筆的權重：$x^2$、$|x|$，或一律同權。`,
            )}
          </p>
          <p>{tm(String.raw`圖上右邊的四格就是下面 F-02.9 方框裡的四列；$r[i]$ 就是公式裡的 $r=y/x$。`)}</p>
        </Diagram>
        <DerivFold>
          <StepDerivation
            title={tm('純量時把更新方向改寫成 $r-w$ 的函數（$x\\neq0$）')}
            steps={[
              { tex: String.raw`r\equiv\frac{y}{x}\;\Rightarrow\;e=y-wx=x\,(r-w)`, why: tm('每一筆資料自己就給出一個 $a$ 的估計 $r$（含雜訊 $v/x$）') },
              { tex: String.raw`\text{LMS: }e\,x=x^2\,(r-w)`, why: tm('乘上 $x$') },
              { tex: String.raw`\text{Sign-Error: }\operatorname{sign}(e)\,x=\operatorname{sign}(x)\operatorname{sign}(r-w)\,x=|x|\operatorname{sign}(r-w)`, why: tm('$\\operatorname{sign}(x(r-w))=\\operatorname{sign}(x)\\operatorname{sign}(r-w)$，$\\operatorname{sign}(x)\\,x=|x|$') },
              { tex: String.raw`\text{Sign-Sign: }\operatorname{sign}(e)\operatorname{sign}(x)=\operatorname{sign}(x)^2\operatorname{sign}(r-w)=\operatorname{sign}(r-w)`, why: tm('$\\operatorname{sign}(x)^2=1$：$x$ 的大小完全消失') },
              { tex: String.raw`\text{NLMS}(\varepsilon=0)\text{: }\frac{e\,x}{x^2}=r-w`, why: tm('除以 $x^2$') },
            ]}
          />
        </DerivFold>
        <p>令平均更新為零，就得到四種「加權位置估計」：</p>
        <TexBlock id="F-02.9">{String.raw`\boxed{\begin{aligned}\text{LMS: }&E[x^2(r-w)]=0&&\Rightarrow\ w^*=\frac{E[x^2r]}{E[x^2]}\ \ (x^2\text{ 加權平均})\\ \text{Sign-Error: }&E[|x|\operatorname{sign}(r-w)]=0&&\Rightarrow\ w^*=|x|\text{ 加權中位數}\\ \text{Sign-Sign: }&E[\operatorname{sign}(r-w)]=0&&\Rightarrow\ w^*=\operatorname{med}(r)\ \ (\text{不加權中位數})\\ \text{NLMS}(\varepsilon\!=\!0)\text{: }&E[r-w]=0&&\Rightarrow\ w^*=E[r]\ \ (\text{不加權平均})\end{aligned}}`}</TexBlock>
        <p>
          <ClaimTag kind="exact" />（純量；對應的成本分別是 <Tex>{'\\tfrac12E[e^2]'}</Tex>、<Tex>{'E|e|'}</Tex>、<Tex>{'E[|e|/|x|]=E|r-w|'}</Tex>、<Tex>{'\\tfrac12E[(r-w)^2]'}</Tex>。）
          所以 Sign-Sign 不是 Sign-Error 的近似：它把每一筆資料<strong>同權</strong>投票，而 Sign-Error 讓 <Tex>{'|x|'}</Tex> 大（資訊量大、比值 <Tex>{'r'}</Tex> 較不受雜訊影響）的樣本票數較多。
        </p>
        <p className="ch02-note">
          小字提醒：NLMS（<Tex>{'\\varepsilon=0'}</Tex>）那一列要 <Tex>{'E[r]=a+E[v/x]'}</Tex> 存在才有意義。若 <Tex>{'x'}</Tex> 可以任意接近 0（例如 Gaussian code），
          <Tex>{'v/x'}</Tex> 是重尾分布，平均與變異數都不存在（<Tex>{String.raw`E[v^2/x^2]=\infty`}</Tex>）——這就是 §5 的 NLMS 一定要加 <Tex>{'\\varepsilon>0'}</Tex> 的原因；主實驗把 <Tex>{'\\varepsilon'}</Tex> 設成 0 時會出現對應的警告。
        </p>
      </Section>

      <Section kind="example" title={tm('先算一次：三筆資料 $(1,3),\\ (2,7),\\ (4,10)$')}>
        <div className="table-wrap">
          <table className="ch02-table">
            <thead>
              <tr>
                <th>
                  <Tex>{'x_i'}</Tex>
                </th>
                <th>
                  <Tex>{'y_i'}</Tex>
                </th>
                <th>
                  <Tex>{'r_i=y_i/x_i'}</Tex>
                </th>
                <th>LMS 權重 <Tex>{'x_i^2'}</Tex></th>
                <th>Sign-Error 權重 <Tex>{'|x_i|'}</Tex></th>
                <th>Sign-Sign 權重</th>
              </tr>
            </thead>
            <tbody>
              {XS.map((x, i) => (
                <tr key={x}>
                  <td className="num">{x}</td>
                  <td className="num">{YS[i]}</td>
                  <td className="num">{f4(YS[i] / x)}</td>
                  <td className="num">{x * x}</td>
                  <td className="num">{Math.abs(x)}</td>
                  <td className="num">1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul>
          <li>
            LMS：<Tex>{String.raw`w^*=\frac{\sum x_iy_i}{\sum x_i^2}=\frac{3+14+40}{1+4+16}=\frac{57}{21}=${f4(rf.lms, 6)}`}</Tex>
          </li>
          <li>
            Sign-Error：比值排序 <Tex>{'2.5\\,(c=4),\\ 3\\,(c=1),\\ 3.5\\,(c=2)'}</Tex>，總權重 7；累積權重 <Tex>{'4>3.5'}</Tex> 在第一個就過半 <Tex>{String.raw`\Rightarrow w^*=${f4(rf.signError[0])}`}</Tex>
          </li>
          <li>
            Sign-Sign：<Tex>{String.raw`\operatorname{med}(2.5,\,3,\,3.5)\Rightarrow w^*=${f4(rf.signSign[0])}`}</Tex>
          </li>
          <li>
            NLMS（<Tex>{'\\varepsilon=0'}</Tex>）：比值的平均 <Tex>{String.raw`(3+3.5+2.5)/3\Rightarrow w^*=${f4(rf.nlms)}`}</Tex>
          </li>
        </ul>
        <Plot
          title="三種批次成本（各自正規化到 $[0,1]$）與最小值位置"
          data={costPlot}
          height={260}
          csvName="ratio-view-costs"
          layout={{ xaxis: { title: { text: 'w' } }, yaxis: { title: { text: '正規化成本' } } }}
          caption={String.raw`同樣三筆資料，三個不同的谷底：中位數類（$\sum|\cdot|$）成本是折線，谷底落在某一筆資料的比值 $r_i$ 上。`}
        />
        <p>
          <SourceTag kind="illustrative" /> 同一組資料、三個演算法、三個答案。真實系統的差異通常比較小，但在雜訊不對稱、或 regressor 不對稱時會出現系統性偏差（下一段）。
        </p>
        <HandCalcSlot id="HC-02.5">
          把三筆資料換成你自己的（試著放一筆很離譜的 <Tex>{'y'}</Tex> 當 outlier），先用紙筆算出四個固定點：兩個「平均」、兩個「中位數」，再對答案。
        </HandCalcSlot>
      </Section>

      <Section kind="formula" title={tm('固定點條件一般不同：$E[ex]=0$ vs $E[\\operatorname{sign}(e)x]=0$')}>
        <p>
          每個演算法都會停在「平均更新量為零」的地方。三種更新量分別是 <Tex>{'e\\,x'}</Tex>、<Tex>{'\\operatorname{sign}(e)\\,x'}</Tex>、<Tex>{'\\operatorname{sign}(e)\\operatorname{sign}(x)'}</Tex>，
          所以三個演算法其實是三個不同的<strong>相關器</strong>（correlator：把兩個訊號相乘、再取平均）：
        </p>
        <Diagram id="fixed-points">
          <p>
            {tm(
              String.raw`先看左邊的兩個輸入：三個相關器吃的是同一個誤差 $e$ 和同一個輸入 $x$。再看藍色的兩格 $\operatorname{sign}(\cdot)$：LMS 那條路徑兩個都不經過；Sign-Error 那條只有 $e$ 經過；Sign-Sign 那條 $e$ 和 $x$ 都經過。最後看右邊：每個演算法會一直調 $w$，直到自己那個相關器的平均輸出變成 0 才停。三個相關器量的是不同的東西，所以一般會停在不同的 $w$。`,
            )}
          </p>
          <p>{tm(String.raw`圖上三個輸出（LMS、Sign-Error、Sign-Sign）依序就是下面 F-02.8 的三個條件。`)}</p>
        </Diagram>
        <TexBlock id="F-02.8">{String.raw`\boxed{E[e\,x]=0\qquad E[\operatorname{sign}(e)\,x]=0\qquad E[\operatorname{sign}(e)\operatorname{sign}(x)]=0}`}</TexBlock>
        <p>
          什麼時候三個固定點剛好都等於真值 <Tex>{'a'}</Tex>？最快的判斷法：直接把 <Tex>{'w=a'}</Tex> 代進平均更新方向 <Tex>{'\\psi(w)'}</Tex>（§3）。
          結論可以先畫成一張判斷流程：
        </p>
        <Diagram id="psi-at-a">
          <p>
            {tm(
              String.raw`先看最上面一格：把 $w=a$ 代進去之後，誤差只剩雜訊（$e=v$），問題變成「雜訊（或它的正負號）乘上 code（或它的正負號），平均是不是 0」。再看兩個菱形，它們是兩道各自獨立的保險：code 對稱（$x$ 與 $-x$ 一樣常出現），或是雜訊的平均與中位數都在 0——只要過其中一關，三個固定點就都是 $a$（綠色）。兩關都沒過（紅色）才需要逐一計算三個乘積：哪一個不是 0，那個演算法的固定點就偏離 $a$。`,
            )}
          </p>
          <p>
            {tm(
              String.raw`圖上紅色格子裡的三個乘積就是下面 F-02.18 的 $\psi_{\rm LMS}(a)$、$\psi_{\rm SE}(a)$、$\psi_{\rm SS}(a)$；菱形裡的 $E[\operatorname{sign}v]=0$ 就是「雜訊的中位數為 0」（推導的第 6 行）。`,
            )}
          </p>
        </Diagram>
        <DerivFold>
          <StepDerivation
            title={tm('在 $w=a$ 處計算 $\\psi$（F-02.18）')}
            steps={[
              { tex: String.raw`w=a\;\Rightarrow\;d=a-w=0,\qquad e=d\,x+v=v`, why: '在真值處參數誤差為 0，誤差只剩雜訊' },
              { tex: String.raw`\psi_{\rm LMS}(a)=E[e\,x]=E[v\,x]=E[v]\,E[x]`, why: tm('$v$ 與 $x$ 獨立：乘積的期望值 = 期望值的乘積（§2 先備知識）') },
              { tex: String.raw`\psi_{\rm SE}(a)=E[\operatorname{sign}(v)\,x]=E[\operatorname{sign}v]\,E[x]`, why: tm('$\\operatorname{sign}(v)$ 只是 $v$ 的函數，仍與 $x$ 獨立') },
              { tex: String.raw`\psi_{\rm SS}(a)=E[\operatorname{sign}(v)\operatorname{sign}(x)]=E[\operatorname{sign}v]\,E[\operatorname{sign}x]`, why: '同理' },
              { tex: String.raw`E[\operatorname{sign}v]=P(v>0)-P(v<0)=1-2F_v(0)`, why: tm('連續雜訊 $P(v=0)=0$；$F_v$ 是 CDF（§3 先備知識）') },
              { tex: String.raw`E[\operatorname{sign}v]=0\iff F_v(0)=\tfrac12\iff\operatorname{med}(v)=0`, why: tm('「sign 的平均為 0」就是「中位數為 0」：LMS 看雜訊的「平均」，sign 類看「中位數」') },
              { tex: String.raw`\psi\ \text{嚴格遞減}\;\Rightarrow\;\big(w^*=a\iff\psi(a)=0\big),\qquad \psi(a)<0\Rightarrow w^*<a`, why: tm('$\\psi$ 只有一個零交越：在 $a$ 處為負，表示 $w$ 在 $a$ 還會往下走，固定點在 $a$ 的左邊') },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.18">{String.raw`\boxed{\psi_{\rm LMS}(a)=E[v]\,E[x],\qquad \psi_{\rm SE}(a)=E[\operatorname{sign}v]\,E[x],\qquad \psi_{\rm SS}(a)=E[\operatorname{sign}v]\,E[\operatorname{sign}x]}`}</TexBlock>
        <p>
          <ClaimTag kind="exact" />（<Tex>{'v'}</Tex> 與 <Tex>{'x'}</Tex> 獨立）於是有兩個充分條件讓三者都等於 <Tex>{'a'}</Tex>：
        </p>
        <ol>
          <li>
            <strong>雜訊的平均與中位數都是 0</strong>（例如對稱雜訊）：<Tex>{'E[v]=0'}</Tex> 且 <Tex>{'E[\\operatorname{sign}v]=0'}</Tex>，不論 code 怎麼分布。
          </li>
          <li>
            <strong>code 對稱</strong>（<Tex>{'x'}</Tex> 與 <Tex>{'-x'}</Tex> 等機率，例如 <Tex>{'\\pm1'}</Tex> PRBS、Gaussian code）：<Tex>{'E[x]=0'}</Tex> 且 <Tex>{'E[\\operatorname{sign}x]=0'}</Tex>，<strong>不論雜訊形狀</strong>。
          </li>
        </ol>
        <p>
          工程意義：<strong>零均值、對稱的 code</strong>（<Tex>{'\\pm1'}</Tex> PRBS、去掉 DC 的 DSM 殘差）讓 1-bit 校正對 comparator 的不對稱雜訊免疫；
          而 0/1 未映射成 <Tex>{'\\pm1'}</Tex> 的 code（<Tex>{'E[x]\\neq0'}</Tex>）會失去這個保護——<ChapterLink ch="11">Ch11</ChapterLink> 的 offset bias 就是這個機制
          （comparator offset 讓 <Tex>{'E[\\operatorname{sign}v]\\neq0'}</Tex>）。
        </p>
        <p>
          反過來，雜訊的平均與中位數不同<strong>而且</strong> <Tex>{'E[x]\\neq0'}</Tex> 時，三個固定點一般不同。下表用 §3 雜訊形狀表的偏斜雜訊（中心化指數）<Tex>{'v=\\sigma_v(T-1)'}</Tex>
          （<Tex>{'T'}</Tex> 為指數分布；<Tex>{'v'}</Tex> 的平均 0、中位數 <Tex>{'\\sigma_v(\\ln2-1)\\approx-0.307\\,\\sigma_v'}</Tex>、
          <Tex>{String.raw`E[\operatorname{sign}v]=1-2F_v(0)=2\,\mathrm{e}^{-1}-1=${f4(signV, 4)}`}</Tex>，<Tex>{String.raw`\mathrm e\approx2.718`}</Tex> 是自然對數的底，不是誤差 <Tex>{'e'}</Tex>）、<Tex>{'a=3,\\ \\sigma_v=1'}</Tex>，以 mean-field 積分計算（對 <Tex>{'v'}</Tex> 為封閉式、對 <Tex>{'x'}</Tex> 為 Simpson 數值積分）：
        </p>
        <div className="table-wrap">
          <table className="ch02-table">
            <thead>
              <tr>
                <th>
                  <Tex>{'x'}</Tex> 的分布
                </th>
                <th className="num">
                  <Tex>{'\\psi_{\\rm SE}(a)'}</Tex>（數值積分）
                </th>
                <th className="num">
                  <Tex>{'E[\\operatorname{sign}v]\\,E[x]'}</Tex>
                </th>
                <th className="num">LMS <Tex>{'w^*'}</Tex></th>
                <th className="num">Sign-Error <Tex>{'w^*'}</Tex></th>
                <th className="num">Sign-Sign <Tex>{'w^*'}</Tex></th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {skew.map((r) => (
                <tr key={r.kind}>
                  <td>
                    <Tex>{X_LABEL[r.kind]}</Tex>
                  </td>
                  <td className="num">{f4(r.psiSe, 5)}</td>
                  <td className="num">{f4(signV * r.ex, 5)}</td>
                  <td className="num">{f4(r.lms, 5)}</td>
                  <td className="num">{f4(r.se, 5)}</td>
                  <td className="num">{f4(r.ss, 5)}</td>
                  <td>
                    {r.kind === 'const'
                      ? tm('平均 vs 中位數：$w^*=a+\\operatorname{med}(v)=3+\\ln2-1$')
                      : r.kind === 'uniformPos'
                        ? tm('三者都不同：$|x|$ 加權中位數 $\\neq$ 不加權中位數')
                        : tm('對稱 $x$：$E[x]=0\\Rightarrow\\psi(a)=0$，全部 $=a$')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          偏斜的指數雜訊比較抽象；量測上更常見的不對稱是<strong>單邊突波</strong>（§3 提過的 outlier：每筆以機率 <Tex>{'p_{\\rm out}'}</Tex> 在 Gaussian 雜訊上多加一個 <Tex>{'s'}</Tex>）。
          這時 <Tex>{'E[v]=p_{\\rm out}s'}</Tex> 可以很大，中位數卻幾乎不動——同一條 F-02.18，可以直接用手算出兩個固定點各被拉走多少：
        </p>
        <HandCalcSlot id="HC-02.6">
          這一題要查一次標準常態表（或用提示裡的近似式）。預設數字就是 §5 主實驗的「單邊 outlier」preset；換成你自己的 <Tex>{'\\sigma_v,\\ p_{\\rm out},\\ s'}</Tex>，
          先算 LMS 與 Sign-Error 的固定點，再對答案，並看看把 <Tex>{'s'}</Tex> 加倍時誰會動。
        </HandCalcSlot>
      </Section>

      <Section kind="explore" title={tm('動手觀察：$\\psi(w)$ 的零交越')}>
        <FixedPointExplorer />
      </Section>

      <ModeGate min="engineer">
        <Section kind="formula" title={tm('核心程式碼：mean-field $\\psi(w)$ 與比值觀點')}>
          <CodeBlock source={sgdSrc} region="meanFieldDrift" path="src/simulation/models/sgd.ts" caption={String.raw`三種演算法的 $\psi(w)$ 只差在對 $e$、$x$ 取了什麼（標「← 差異」的行）。$E_v[\operatorname{sign}(c+v)]=1-2F_v(-c)$ 用雜訊 CDF 的封閉式計算。`} />
          <CodeBlock source={sgdSrc} region="ratioView" path="src/simulation/models/sgd.ts" />
        </Section>
      </ModeGate>

      <ModeGate min="research">
        <Derivation
          title="研究：多參數時 Sign-Sign 不是任何成本的梯度"
          claim="research"
          level="L0"
          defaultOpen
          derivation={
            <>
              <p>
                多參數時 Sign-Error 的平均方向 <Tex>{'E[\\operatorname{sign}(e)\\mathbf x]=-\\nabla E|e|'}</Tex> 仍是凸成本的（次）梯度；但 Sign-Sign 的
                <Tex>{'E[\\operatorname{sign}(e)\\operatorname{sign}(\\mathbf x)]'}</Tex> 的 Jacobian 一般不對稱，因此<strong>不是任何純量成本的梯度</strong>，
                「下山」的保證消失。文獻（例如 Sethares 等人對 signed-regressor LMS 的 excitation 條件分析）指出存在讓 signed-regressor 類演算法不收斂的輸入；
                純量情況（本章）不會發生，因為一維的任何函數都可以積分成成本 <Tex>{'E|r-w|'}</Tex>。
              </p>
              <p className="ch02-note">本站只在純量模型中驗證 Sign-Sign；多參數 Sign-Sign 的收斂性列為研究延伸，未實作數值驗證。</p>
            </>
          }
        />
      </ModeGate>

      <Callout kind="info" title="一句話">
        <Tex>{'\\operatorname{sign}(e)\\,x'}</Tex> 與 <Tex>{'\\operatorname{sign}(e)\\operatorname{sign}(x)'}</Tex> 的差別不是「精度少幾個 bit」，而是<strong>目標函數不同</strong>：前者是 <Tex>{'|x|'}</Tex> 加權中位數，後者是不加權中位數（都是 <Tex>{'r=y/x'}</Tex> 的中位數類估計）。
      </Callout>

      <Quiz
        title="思考題 4（比值觀點）"
        question={
          <>
            資料 <Tex>{'(x,y)=(1,3),(2,7),(4,10)'}</Tex> 反覆循環餵給演算法、<Tex>{'\\mu'}</Tex> 很小。哪一組是 LMS / Sign-Error / Sign-Sign 的收斂點？
          </>
        }
        options={[
          { label: '3 / 3 / 3' },
          { label: <Tex>{`${f4(rf.lms, 4)}\\ /\\ ${f4(rf.signError[0])}\\ /\\ ${f4(rf.signSign[0])}`}</Tex>, correct: true },
          { label: <Tex>{`${f4(rf.lms, 4)}\\ /\\ ${f4(rf.signSign[0])}\\ /\\ ${f4(rf.signError[0])}`}</Tex> },
          { label: <Tex>{`${f4(rf.nlms)}\\ /\\ ${f4(rf.signError[0])}\\ /\\ ${f4(rf.signSign[0])}`}</Tex> },
        ]}
        answer={
          <>
            比值 <Tex>{'r=3,\\ 3.5,\\ 2.5'}</Tex>。LMS 是 <Tex>{'x^2'}</Tex> 加權平均 <Tex>{'57/21'}</Tex>；Sign-Error 是 <Tex>{'|x|'}</Tex> 加權中位數（2.5 的權重 4 已過半）；
            Sign-Sign 是不加權中位數 3。第四個選項的 3 是 NLMS（不加權平均）。<Tex>{'\\mu'}</Tex> 不夠小時，sign 類演算法會在答案附近以 <Tex>{'\\pm\\mu|x|'}</Tex> 跳動。
          </>
        }
      />
    </section>
  )
}
