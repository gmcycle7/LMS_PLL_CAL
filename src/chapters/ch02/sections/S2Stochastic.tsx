import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Prereq, Quiz, Section, StepDerivation, Tex, TexBlock, ChRef, ChapterErratum } from '@/components'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import sgdSrc from '@/simulation/models/sgd.ts?raw'
import { Diagram, DerivFold, tm } from '../common'
import { BatchVsSgd } from '../experiments/BatchVsSgd'

/** §2 Batch GD vs Stochastic GD；LMS = SGD。 */
export function S2Stochastic() {
  return (
    <section id="ch02-s2">
      <h2>§2 Batch GD vs Stochastic GD：LMS 就是 SGD</h2>

      <Section id="ch02-noisy-slope" kind="intuition" title="有雜訊時，「坡度」是什麼？">
        <p>
          §1 的成本只用一筆資料。真實量測有雜訊 <Tex>{'v'}</Tex>（量測時混進來、我們控制不了的隨機擾動）：<Tex>{'y=ax+v'}</Tex>。單一筆 <Tex>{'(x,y)'}</Tex> 的坡度會被雜訊帶偏，我們真正想下的山是「很多筆的平均成本」。問題是：平均需要很多筆資料，硬體每來一筆就想更新一次——可以只用一筆的坡度嗎？
        </p>
      </Section>

      <Prereq title={String.raw`期望值 $E[\cdot]$、獨立、相關、變異數（第一次出現）`}>
        <ul>
          <li>
            <strong>期望值（expectation）</strong> <Tex>{'E[X]'}</Tex>：把同一個隨機實驗做非常多次再平均的極限。離散時 <Tex>{'E[X]=\\sum_k p_kx_k'}</Tex>，連續時 <Tex>{'E[X]=\\int x\\,f(x)\\,dx'}</Tex>（<Tex>{'f'}</Tex> 是機率密度 PDF）。
          </li>
          <li>
            <strong>線性</strong>：<Tex>{'E[\\alpha X+\\beta Y]=\\alpha E[X]+\\beta E[Y]'}</Tex>（積分 / 求和本來就是線性的）。所以「先微分再平均」與「先平均再微分」可以交換。
          </li>
          <li>
            <strong>獨立（independence）</strong>：<Tex>{'X'}</Tex> 的結果不影響 <Tex>{'Y'}</Tex> 的機率。獨立時 <Tex>{'E[XY]=E[X]E[Y]'}</Tex>。
          </li>
          <li>
            <strong>相關（correlation）</strong> <Tex>{'E[e\\,x]'}</Tex>：兩個訊號乘積的平均。<Tex>{'e'}</Tex> 傾向與 <Tex>{'x'}</Tex> 同號時 <Tex>{'E[ex]>0'}</Tex>，代表誤差裡還殘留「跟著 <Tex>{'x'}</Tex> 走」的成分（<Tex>{'w'}</Tex> 太小）；GMAC 在硬體裡估計的就是這個量（<ChRef ch="04">Ch04</ChRef>）。
          </li>
          <li>
            <strong>變異數（variance）</strong> <Tex>{'\\operatorname{Var}(X)=E[(X-E[X])^2]=E[X^2]-E[X]^2'}</Tex>：偏離平均的程度；標準差 <Tex>{'\\sigma=\\sqrt{\\operatorname{Var}}'}</Tex>。
          </li>
        </ul>
      </Prereq>

      <Section id="ch02-mean-cost" kind="formula" title="平均成本與它的梯度">
        <p>
          有雜訊時，「山」要改成很多筆資料的<strong>平均</strong>成本，「坡度」也跟著變成平均坡度。先看訊號怎麼流，再看公式：
        </p>
        <Diagram id="cost-gradient">
          <p>
            {tm(
              String.raw`先看雜訊 $v[n]$ 那一格：量測值現在多了一項雜訊，$y[n]=a\,x[n]+v[n]$。再看中間的減法：誤差因此有兩個成分——$(a-w)\,x[n]$ 是「$w$ 還沒調對」造成的，$v[n]$ 是雜訊造成的。最後看藍色的「取平均」：把很多筆的 $e[n]\,x[n]$ 平均起來（期望值 $E[\cdot]$，上面的先備知識框有解釋），得到的就是負的平均坡度 $-J'(w)$。取平均的期間 $w$ 固定不動，所以圖上的 $w$ 沒有寫時間索引。`,
            )}
          </p>
          <p>
            {tm(
              String.raw`圖上最後那一格就是下面 F-02.3 的 $J'(w)=-E[e\,x]$ 搬一個負號；展開之後是推導第 4 行的結果：$P_x=E[x^2]$ 是輸入功率（$x$ 平方的平均），$E[x\,v]$ 是輸入與雜訊的相關——兩者獨立、雜訊平均為 0 時它是 0，谷底 $w^*$（坡度為零的點，也叫固定點）就剛好在真值 $a$。`,
            )}
          </p>
        </Diagram>
        <TexBlock id="F-02.3">{String.raw`\boxed{J(w)=\tfrac12E\big[(y-wx)^2\big],\qquad J'(w)=-E[e\,x]}`}</TexBlock>
        <p>
          <ChapterErratum id="E41" /> 有 <Tex>{'\\tfrac12'}</Tex>：單筆成本 <Tex>{'\\tfrac12e^2'}</Tex> 的期望值剛好就是 <Tex>{'J'}</Tex>。把模型 <Tex>{'y=ax+v'}</Tex> 代進去展開：
        </p>
        <DerivFold>
          <StepDerivation
            steps={[
              { tex: String.raw`e=y-wx=ax+v-wx=(a-w)x+v`, why: '代入模型；誤差 = 參數誤差造成的部分 + 雜訊' },
              { tex: String.raw`e^2=(a-w)^2x^2+2(a-w)\,x\,v+v^2`, why: '完全平方展開' },
              { tex: String.raw`J(w)=\tfrac12(a-w)^2E[x^2]+(a-w)E[x\,v]+\tfrac12E[v^2]`, why: tm('取期望值（線性）；$w$、$a$ 是常數可以提出來') },
              { tex: String.raw`J'(w)=-(a-w)P_x-E[x\,v],\qquad P_x\equiv E[x^2]`, why: tm('對 $w$ 微分：$(a-w)^2$ 的導數是 $-2(a-w)$') },
              { tex: String.raw`J'(w^*)=0\;\Rightarrow\;w^*=a+\frac{E[x\,v]}{P_x}`, why: '谷底：斜率為零' },
              { tex: String.raw`E[x\,v]=E[x]E[v]=0\;\Rightarrow\;w^*=a`, why: tm('$x$ 與 $v$ 獨立、且雜訊零均值時，谷底就在真值') },
            ]}
          />
        </DerivFold>
        <p>
          <ClaimTag kind="exact" /> 若雜訊與 <Tex>{'x'}</Tex> 相關，或 <Tex>{'E[v]\\neq0'}</Tex> 而 <Tex>{'E[x]\\neq0'}</Tex>（例如 comparator offset 配上非零均值的 code），谷底就不在 <Tex>{'a'}</Tex>——這是 <ChRef ch="11">Ch11</ChRef> bias 的根源。
        </p>
      </Section>

      <Section id="ch02-batch-sgd" kind="formula" title="Batch GD 與 Stochastic GD">
        <p>期望值要無限多筆資料。實作上只能用有限筆來代替，差別在「累加幾筆才更新一次」：</p>
        <Diagram id="batch-vs-sgd">
          <p>
            {tm(
              String.raw`先看 Batch GD 那一排：把全部 $N$ 筆資料（$N$：資料的總筆數）的 $e\,x$ 累加起來、除以 $N$，才更新一次 $w$。再看 Mini-batch 那一排：只累加 $B$ 筆就更新（$B$：batch 大小）。最後看 SGD 那一排：藍色的「累加」與「$\div$」兩格整個不見了，每來一筆就更新一次。三排其餘的方塊完全相同。`,
            )}
          </p>
          <p>{tm(String.raw`圖上 Batch GD 那一排的四格「$e[i]\,x[i]$、累加、$\div N$、$\times\mu$」依序就是下面左式的 $e_ix_i$、$\sum$、$\tfrac1N$、$\mu$；SGD 那一排就是右式。`)}</p>
        </Diagram>
        <p>寫成公式，最兩端的做法是：</p>
        <TexBlock>{String.raw`\underbrace{w\leftarrow w+\mu\,\frac1N\sum_{i=1}^{N}e_i\,x_i}_{\text{Batch GD：N 筆的平均梯度}}\qquad\qquad\underbrace{w_{n+1}=w_n+\mu\,e_n\,x_n}_{\text{SGD：只用第 n 筆}}`}</TexBlock>
        <p>把右邊的 SGD 畫成一條完整的迴圈（含雜訊），它就是 LMS，也是 §3、§4 要動手術的對象：</p>
        <Diagram id="lms-loop">
          <p>
            {tm(
              String.raw`先看最上面的三格：同一個輸入 $x[n]$ 同時送進黑盒子（乘上未知的 $a$）和我們的預測器（乘上目前的 $w[n]$）；黑盒子的輸出加上雜訊 $v[n]$ 就是量測值 $y[n]=a\,x[n]+v[n]$，預測器的輸出是 $\hat y[n]=w[n]\,x[n]$，兩者相減得到誤差 $e[n]$。再看藍色的「$\times\,x[n]$」：誤差乘上輸入，得到單筆的負坡度 $e[n]\,x[n]$（下面馬上定義：它就是 $-\hat g[n]$，$\hat g$ 是單筆梯度）。最後看下半部：乘上步長 $\mu$ 之後加到 $w[n]$ 上，$z^{-1}$ 把新的 $w[n+1]$ 送回預測器和加法點。這和 §1 的「量坡度」展開圖是同一個迴圈，只是多了雜訊 $v$，而且 $x$ 不必是固定的數。`,
            )}
          </p>
          <p>{tm(String.raw`圖上的 $e[n]$、$x[n]$、$\Delta w[n]$ 就是上面右式（下面的 F-02.5 會再證明它）$w_{n+1}=w_n+\mu\,e_nx_n$ 裡的 $e_n$、$x_n$ 與 $\mu\,e_nx_n$。`)}</p>
        </Diagram>
        <p>SGD 的單筆梯度 <Tex>{'\\hat g_n=-e_nx_n'}</Tex>（只用第 <Tex>{'n'}</Tex> 筆資料估出來的坡度）會不會「系統性地」指錯方向？把上一張圖藍色那一格的輸出加個負號，再拆開來看：</p>
        <Diagram id="sgd-noise">
          <p>
            {tm(
              String.raw`先看第一個加法點：單筆坡度 $\hat g[n]$ 可以拆成兩部分——真正的坡度 $J'(w[n])$，加上紅色的「梯度雜訊」（這一筆資料剛好偏高或偏低的部分）。下面要證明的「不偏」，就是紅色那一項的平均是 0；但它的變異不是 0，所以每一步都會被隨機推一下。再看後半段：乘上 $-\mu$ 之後加到 $w[n]$ 上，和上一張圖的下半部完全一樣，只是坡度換成了單筆的估計。`,
            )}
          </p>
          <p>{tm(String.raw`圖上的 $\hat g[n]$ 就是 F-02.4 的 $\hat g_n$；第二個加法點上的 $\mu\,e[n]\,x[n]$ 就是 F-02.5 的更新量；紅色那一項的變異，就是稍後 F-02.16 穩態抖動的來源。`)}</p>
        </Diagram>
        <p>下面證明紅色那一項的平均確實是 0——單筆梯度在平均意義下完全正確：</p>
        <DerivFold>
          <StepDerivation
            title="單筆梯度是不偏估計（unbiased）"
            steps={[
              { tex: String.raw`\hat g_n=-e_nx_n=-(y_n-w_nx_n)\,x_n`, why: tm("定義：把 $J'$ 裡的 $E[\\cdot]$ 拿掉，只用第 $n$ 筆") },
              { tex: String.raw`E[\hat g_n\mid w_n=w]=-E\big[(y_n-w\,x_n)\,x_n\big]`, why: tm('給定目前的 $w$（當作常數）再取平均') },
              { tex: String.raw`=-E\big[(y-w\,x)\,x\big]`, why: tm('$(x_n,v_n)$ 與 $w_n$ 獨立：$w_n$ 只由 $w_0$ 與過去的 $(x_0,v_0)\\ldots(x_{n-1},v_{n-1})$ 決定，而資料是 iid（勘誤 E38），所以第 $n$ 筆的分布與 $w_n$ 無關') },
              { tex: String.raw`=\frac{d}{dw}\,\tfrac12E\big[(y-wx)^2\big]=J'(w)`, why: tm("期望值與微分可交換（線性），回到上面的 $J'$") },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.4">{String.raw`\boxed{E\big[\hat g_n\,\big|\,w_n=w\big]=J'(w)}`}</TexBlock>
        <p>所以「沿著單筆梯度走」在平均上就是沿著真正的梯度走：</p>
        <TexBlock id="F-02.5">{String.raw`\boxed{w_{n+1}=w_n-\mu\hat g_n=w_n+\mu\,e_nx_n}`}</TexBlock>
        <p>
          這正是 LMS。<strong>LMS = 對 <Tex>{'\\tfrac12E[e^2]'}</Tex> 的 Stochastic Gradient Descent。</strong>「Least Mean Squares」的 Mean 是目標（平均成本），演算法本身每步只看一筆。 <ClaimTag kind="exact" />（iid 資料、<Tex>{'x'}</Tex> 與 <Tex>{'v'}</Tex> 獨立）
        </p>
      </Section>

      <Section id="ch02-grad-noise" kind="formula" title={tm('不偏 $\\neq$ 不抖：梯度雜訊')}>
        <p>
          即使站在谷底 <Tex>{'w=w^*=a'}</Tex>，單筆梯度也不是 0（下面的 <Tex>{'\\sigma_v'}</Tex> 是雜訊 <Tex>{'v'}</Tex> 的標準差，<Tex>{'\\sigma_v^2=E[v^2]'}</Tex>）：
        </p>
        <DerivFold>
          <StepDerivation
            steps={[
              { tex: String.raw`\hat g\big|_{w=a}=-(a\,x+v-a\,x)\,x=-v\,x`, why: '在谷底誤差只剩雜訊' },
              { tex: String.raw`E[\hat g]=-E[v]E[x]=0`, why: '平均是 0（谷底）' },
              { tex: String.raw`\operatorname{Var}(\hat g)=E[v^2x^2]=\sigma_v^2P_x>0`, why: tm('獨立 $\\Rightarrow E[v^2x^2]=E[v^2]E[x^2]$') },
            ]}
          />
        </DerivFold>
        <p>
          所以固定步長的 SGD 永遠在谷底附近抖動，停不下來。精確的穩態均方偏差（iid 的 <Tex>{'x'}</Tex>）為
        </p>
        <TexBlock id="F-02.16">{String.raw`E[\delta^2]_\infty=\frac{\mu\,\sigma_v^2P_x}{2P_x-\mu E[x^4]}\;\approx\;\frac{\mu\sigma_v^2}{2}\quad(\mu\to0)`}</TexBlock>
        <p>
          <ClaimTag kind="exact" /> 這裡 <Tex>{'E[\\delta^2]_\\infty'}</Tex> 是收斂之後參數誤差平方的平均（mean-square deviation，MSD），<Tex>{'E[x^4]'}</Tex> 是輸入四次方的平均（四階動差）。推導與 mean / mean-square 穩定界在 <a href="#/ch/03">Ch03</a>（注意這是係數的 MSD，不是成本 MSE，<ChapterErratum id="E42" />）。要讓抖動變小，有兩條路：<strong>平均更多筆再更新</strong>（mini-batch：每累加 <Tex>{'B'}</Tex> 筆更新一次，梯度雜訊變異 <Tex>{'\\propto1/B'}</Tex>），或<strong>讓步長隨時間變小</strong>（§3 的遞減步長）。
        </p>
        <p className="ch02-note" data-handcalc-pointer="s2">
          <strong>想親手代數字？</strong>這一節的三條公式都有對應的手算題：單筆更新 <Tex>{'w+\\mu\\,e\\,x'}</Tex>（F-02.5）就是 §1 手算題 HC-02.1 走的那一步，§4 的 HC-02.4 再用同一組數字和 Sign-Error、Sign-Sign 並排比較；谷底條件「平均梯度為零」（F-02.3）的有限資料版 <Tex>{'\\sum_ie_ix_i=0'}</Tex> 在 HC-02.5 用三筆資料算出 <Tex>{'w^*=\\sum x_iy_i/\\sum x_i^2'}</Tex>；穩態抖動（F-02.16）在章末的綜合題 HC-02.8 代數字。
        </p>
      </Section>

      <Section id="ch02-sgd-compare" kind="example" title="三種做法的比較">
        <div className="table-wrap">
          <table className="ch02-table">
            <thead>
              <tr>
                <th>做法</th>
                <th>每次更新用幾筆</th>
                <th>{tm('更新方向的雜訊變異（$w=w^*$ 時）')}</th>
                <th>記憶體／延遲</th>
                <th>硬體對應</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Batch GD</td>
                <td>
                  全部 <Tex>{'N'}</Tex>
                </td>
                <td>
                  <Tex>{'\\sigma_v^2P_x/N'}</Tex>（收斂到這 <Tex>{'N'}</Tex> 筆資料的最小平方解 <Tex>{'w_{LS}=\\sum x_iy_i/\\sum x_i^2'}</Tex>）
                </td>
                <td>
                  存 <Tex>{'N'}</Tex> 筆或累加 <Tex>{'N'}</Tex> 筆；每 <Tex>{'N'}</Tex> 筆才更新一次
                </td>
                <td>離線校正（foreground）</td>
              </tr>
              <tr>
                <td>Mini-batch</td>
                <td>
                  <Tex>{'B'}</Tex>
                </td>
                <td>
                  <Tex>{'\\sigma_v^2P_x/B'}</Tex>
                </td>
                <td>
                  一個累加器；每 <Tex>{'B'}</Tex> 筆更新
                </td>
                <td>
                  <strong>
                    Block GMAC：累加 <Tex>{'N'}</Tex> 筆 <Tex>{'q\\,x'}</Tex> 再更新一次
                  </strong>
                  （<ChRef ch="04">Ch04</ChRef>、<ChRef ch="14">Ch14</ChRef>）
                </td>
              </tr>
              <tr>
                <td>SGD（LMS）</td>
                <td>1</td>
                <td>
                  <Tex>{'\\sigma_v^2P_x'}</Tex>
                </td>
                <td>不需記憶；每筆更新</td>
                <td>逐 sample 的 LMS（背景追蹤）</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="ch02-sgd-lab" kind="explore" title="動手觀察：同一組資料、同樣看過的樣本數">
        <BatchVsSgd />
      </Section>

      <ModeGate min="engineer">
        <Section id="ch02-sgd-code" kind="formula" title={tm('核心程式碼：$B=1$ 就是 LMS')}>
          <CodeCompare
            items={[
              { label: 'SGD = LMS（lms.ts）', source: lmsSrc, region: 'conventionalStep', path: 'src/simulation/models/lms.ts', note: String.raw`每一筆都更新：$\Delta w=\mu\,e\,x$` },
              { label: 'Mini-batch（sgd.ts）', source: sgdSrc, region: 'miniBatchStep', path: 'src/simulation/models/sgd.ts', note: String.raw`累加 $B$ 筆的 $e_ix_i$ 再除以 $B$` },
            ]}
            caption="$B=1$ 時 miniBatchStep 與 conventionalStep 完全相同；$B=N$ 就是 batch GD。"
          />
          <CodeBlock source={sgdSrc} region="batchVsSgd" path="src/simulation/models/sgd.ts" title="上方實驗的主迴圈（同一組資料、每 epoch 洗牌）" />
        </Section>
      </ModeGate>

      <Callout kind="info" title="連到 PLL">
        硬體的 GMAC 每個 block 累加 <Tex>{'G_k=\\frac1N\\sum q[n]\\,x[n]'}</Tex> 再更新一次係數：這是 mini-batch，batch 大小就是 <Tex>{'N'}</Tex>。
        <Tex>{'N'}</Tex> 越大，每次更新越準、但更新越慢（更新率 <Tex>{'f_u=f_s/N'}</Tex>，<Tex>{'f_s'}</Tex> 是 comparator 的取樣率）。最佳的 <Tex>{'N'}</Tex> 與 <Tex>{'\\mu'}</Tex> 怎麼選，見 <a href="#/ch/14">Ch14</a>。
      </Callout>

      <Section id="ch02-timescales" kind="diagram" title="時間軸：sample 與 block 兩種速率">
        <Diagram id="block-timing">
          <p>
            {tm(
              String.raw`先看最上面的說明條：整個 block 裡用的都是同一個係數 $w_k$（$k$ 是 block 的編號），comparator 看到的每一筆誤差都是用它算出來的。再看中間的迴圈：每個 sample（編號 $n$）comparator 送出一個正負號 $q[n]=\operatorname{sign}(e[n])$（誤差的正負號，$\pm1$；§3 的主角），乘上當時的 code $x[n]$ 後加進 GMAC 的累加器，一共 $N$ 筆。最後看下面的箭頭：block 結束時，GMAC 把平均值 $G_k$ 交出去，係數才更新一次，下一個 block 改用新的 $w$。`,
            )}
          </p>
          <p>
            {tm(
              String.raw`所以圖上有兩種速率：$q[n]$、$x[n]$ 每個 sample 一筆（速率 $f_s$）；$G_k$、$w_k$ 每個 block 一筆（速率 $f_u=f_s/N$）。圖上的 $G_k$ 就是上面那句話裡的 $\frac1N\sum q[n]\,x[n]$，也就是 mini-batch 那一排的「累加 $B$ 筆、$\div B$」（$B=N$），只是把 $e$ 換成了它的正負號 $q$；「新的 $w$」就是 $w_{k+1}=w_k+\mu\,G_k$。`,
            )}
          </p>
        </Diagram>
      </Section>

      <Quiz
        title="思考題 2（不偏的前提）"
        question={
          <>
            如果 regressor 有時間相關（例如 <Tex>{'x_n=x_{n-1}+\\text{小擾動}'}</Tex>），「單筆梯度是不偏估計」的推導哪一步會失效？
          </>
        }
        options={[
          { label: '泰勒展開那一步' },
          { label: <>「<Tex>{'(x_n,y_n)'}</Tex> 與 <Tex>{'w_n'}</Tex> 獨立」那一步</>, correct: true },
          { label: '期望值與微分交換那一步' },
          { label: '都不會失效' },
        ]}
        answer={
          <>
            <Tex>{'w_n'}</Tex> 由 <Tex>{'x_0\\ldots x_{n-1}'}</Tex> 決定；若 <Tex>{'x_n'}</Tex> 與 <Tex>{'x_{n-1}'}</Tex> 相關，<Tex>{'x_n'}</Tex> 就與 <Tex>{'w_n'}</Tex> 相關，不能把 <Tex>{'w_n'}</Tex> 當成與第 <Tex>{'n'}</Tex> 筆無關的常數。此時公式降為 independence approximation <ClaimTag kind="approx" />（勘誤 E38）。Part B 的有效 regressor <Tex>{'u=h*x'}</Tex> 正是這種情況。
          </>
        }
      />
    </section>
  )
}
