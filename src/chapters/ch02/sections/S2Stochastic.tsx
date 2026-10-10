import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Prereq, Quiz, Section, StepDerivation, Tex, TexBlock } from '@/components'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import sgdSrc from '@/simulation/models/sgd.ts?raw'
import { ErrataNote, DerivFold, tm } from '../common'
import { BatchVsSgd } from '../experiments/BatchVsSgd'

/** §2 Batch GD vs Stochastic GD；LMS = SGD。 */
export function S2Stochastic() {
  return (
    <section>
      <h2 id="ch02-s2">§2 Batch GD vs Stochastic GD：LMS 就是 SGD</h2>

      <Section kind="intuition" title="有雜訊時，「坡度」是什麼？">
        <p>
          §1 的成本只用一筆資料。真實量測有雜訊 <Tex>{'v'}</Tex>：<Tex>{'y=ax+v'}</Tex>。單一筆 <Tex>{'(x,y)'}</Tex> 的坡度會被雜訊帶偏，我們真正想下的山是
          「很多筆的平均成本」。問題是：平均需要很多筆資料，硬體每來一筆就想更新一次——可以只用一筆的坡度嗎？
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
            <strong>相關（correlation）</strong> <Tex>{'E[e\\,x]'}</Tex>：兩個訊號乘積的平均。<Tex>{'e'}</Tex> 傾向與 <Tex>{'x'}</Tex> 同號時 <Tex>{'E[ex]>0'}</Tex>，代表誤差裡還殘留「跟著 <Tex>{'x'}</Tex> 走」的成分（<Tex>{'w'}</Tex> 太小）；
            GMAC 在硬體裡估計的就是這個量（Ch04）。
          </li>
          <li>
            <strong>變異數（variance）</strong> <Tex>{'\\operatorname{Var}(X)=E[(X-E[X])^2]=E[X^2]-E[X]^2'}</Tex>：偏離平均的程度；標準差 <Tex>{'\\sigma=\\sqrt{\\operatorname{Var}}'}</Tex>。
          </li>
        </ul>
      </Prereq>

      <Section kind="formula" title="平均成本與它的梯度">
        <TexBlock id="F-02.3">{String.raw`\boxed{J(w)=\tfrac12E\big[(y-wx)^2\big],\qquad J'(w)=-E[e\,x]}`}</TexBlock>
        <p>
          <ErrataNote id="E41" /> 有 <Tex>{'\\tfrac12'}</Tex>：單筆成本 <Tex>{'\\tfrac12e^2'}</Tex> 的期望值剛好就是 <Tex>{'J'}</Tex>。把模型 <Tex>{'y=ax+v'}</Tex> 代進去展開：
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
          <ClaimTag kind="exact" /> 若雜訊與 <Tex>{'x'}</Tex> 相關，或 <Tex>{'E[v]\\neq0'}</Tex> 而 <Tex>{'E[x]\\neq0'}</Tex>（例如 comparator offset 配上非零均值的 code），谷底就不在 <Tex>{'a'}</Tex>——這是 Ch11 bias 的根源。
        </p>
      </Section>

      <Section kind="formula" title="Batch GD 與 Stochastic GD">
        <p>期望值要無限多筆資料。實作上有兩種替代：</p>
        <TexBlock>{String.raw`\underbrace{w\leftarrow w+\mu\,\frac1N\sum_{i=1}^{N}e_i\,x_i}_{\text{Batch GD：N 筆的平均梯度}}\qquad\qquad\underbrace{w_{n+1}=w_n+\mu\,e_n\,x_n}_{\text{SGD：只用第 n 筆}}`}</TexBlock>
        <p>SGD 的單筆梯度 <Tex>{'\\hat g_n=-e_nx_n'}</Tex> 會不會「系統性地」指錯方向？下面證明它在平均意義下完全正確：</p>
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
          這正是 LMS。<strong>LMS = 對 <Tex>{'\\tfrac12E[e^2]'}</Tex> 的 Stochastic Gradient Descent。</strong>「Least Mean Squares」的 Mean 是目標（平均成本），
          演算法本身每步只看一筆。 <ClaimTag kind="exact" />（iid 資料、<Tex>{'x'}</Tex> 與 <Tex>{'v'}</Tex> 獨立）
        </p>
      </Section>

      <Section kind="formula" title={tm('不偏 $\\neq$ 不抖：梯度雜訊')}>
        <p>即使站在谷底 <Tex>{'w=w^*=a'}</Tex>，單筆梯度也不是 0：</p>
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
          <ClaimTag kind="exact" /> 推導與 mean / mean-square 穩定界在 <a href="#/ch/03">Ch03</a>（注意這是係數的 MSD，不是成本 MSE，<ErrataNote id="E42" />）。
          要讓抖動變小，有兩條路：<strong>平均更多筆再更新</strong>（mini-batch，梯度雜訊變異 <Tex>{'\\propto1/B'}</Tex>），或<strong>讓步長隨時間變小</strong>（§3 的遞減步長）。
        </p>
        <p className="ch02-note" data-handcalc-pointer="s2">
          <strong>想親手代數字？</strong>這一節的三條公式都有對應的手算題：單筆更新 <Tex>{'w+\\mu\\,e\\,x'}</Tex>（F-02.5）就是 §1 手算題 HC-02.1 走的那一步，§4 的 HC-02.4 再用同一組數字和 Sign-Error、Sign-Sign 並排比較；
          谷底條件「平均梯度為零」（F-02.3）的有限資料版 <Tex>{'\\sum_ie_ix_i=0'}</Tex> 在 HC-02.5 用三筆資料算出 <Tex>{'w^*=\\sum x_iy_i/\\sum x_i^2'}</Tex>；穩態抖動（F-02.16）在章末的綜合題 HC-02.8 代數字。
        </p>
      </Section>

      <Section kind="example" title="三種做法的比較">
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
                  <Tex>{'\\sigma_v^2P_x/N'}</Tex>（收斂到有限資料的 <Tex>{'w_{LS}'}</Tex>）
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
                  （Ch04、Ch14）
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

      <Section kind="explore" title="動手觀察：同一組資料、同樣看過的樣本數">
        <BatchVsSgd />
      </Section>

      <ModeGate min="engineer">
        <Section kind="formula" title={tm('核心程式碼：$B=1$ 就是 LMS')}>
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
        <Tex>{'N'}</Tex> 越大，每次更新越準、但更新越慢（更新率 <Tex>{'f_u=f_s/N'}</Tex>）。最佳的 <Tex>{'N'}</Tex> 與 <Tex>{'\\mu'}</Tex> 怎麼選，見 <a href="#/ch/14">Ch14</a>。
      </Callout>

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
            <Tex>{'w_n'}</Tex> 由 <Tex>{'x_0\\ldots x_{n-1}'}</Tex> 決定；若 <Tex>{'x_n'}</Tex> 與 <Tex>{'x_{n-1}'}</Tex> 相關，<Tex>{'x_n'}</Tex> 就與 <Tex>{'w_n'}</Tex> 相關，
            不能把 <Tex>{'w_n'}</Tex> 當成與第 <Tex>{'n'}</Tex> 筆無關的常數。此時公式降為 independence approximation <ClaimTag kind="approx" />（勘誤 E38）。
            Part B 的有效 regressor <Tex>{'u=h*x'}</Tex> 正是這種情況。
          </>
        }
      />
    </section>
  )
}
