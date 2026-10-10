import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, Derivation, ModeGate, Prereq, Quiz, Section, StepDerivation, Tex, TexBlock } from '@/components'
import sgdSrc from '@/simulation/models/sgd.ts?raw'
import { gradientDescent } from '@/simulation/models/sgd'
import { ErrataNote, HandCalcSlot, f4, DerivFold, tm } from '../common'
import { GdExplorer } from '../experiments/GdExplorer'

/** §1 從切線斜率到 Gradient Descent（只用微積分）。 */
export function S1GradientDescent() {
  // 手算例子：a=3, x=2, w0=1, μ=0.1（規格 §1.2 / T01）——數字一律由程式計算
  const t = useMemo(() => gradientDescent({ a: 3, x: 2, w0: 1, mu: 0.1, steps: 3, cost: 'half' }), [])
  const tanPred = t.J[0] + t.dJ[0] * t.dw[0]
  const curvTerm = 0.5 * 4 * t.dw[0] ** 2

  return (
    <section>
      <h2 id="ch02-s1">§1 從切線斜率到 Gradient Descent</h2>

      <Section kind="intuition" title="矇眼下山：只看腳下的坡度">
        <p>
          你不知道谷底在哪，但腳可以感覺坡度 <Tex>{"J'(w)"}</Tex>（切線斜率）。坡度為正代表「往右是上坡」，所以要往左走；坡度為負就往右走。
          坡越陡、離谷底通常越遠，可以走大步一點。把這句話寫成公式就是：
        </p>
        <TexBlock id="F-02.1">{String.raw`\boxed{w_{n+1}=w_n-\mu\,J'(w_n)}\qquad(\mu>0\text{：步長})`}</TexBlock>
        <p>
          這就是 <strong>Gradient Descent（梯度下降）</strong>。只有一個參數時「梯度」就是導數；多個參數時是偏導數排成的向量（Ch09–Ch10）。
        </p>
      </Section>

      <Section kind="example" title={tm('先算一次：$a=3,\\ x=2,\\ w_0=1,\\ \\mu=0.1$')}>
        <p>
          黑盒子 <Tex>{'y=ax'}</Tex>、<Tex>{'a=3'}</Tex>，我們給 <Tex>{'x=2'}</Tex>、量到 <Tex>{'y=6'}</Tex>。用單筆成本 <Tex>{'J(w)=\\tfrac12(y-wx)^2=\\tfrac12(6-2w)^2'}</Tex>：
        </p>
        <StepDerivation
          title="第 0 步（每個數字都由下方實驗用的同一個函式計算）"
          steps={[
            { tex: String.raw`e_0=y-w_0x=6-1\times2=${f4(t.e[0])}`, why: tm('先預測 $\\hat y=w_0x=2$，再和量測值比較') },
            { tex: String.raw`J'(w_0)=\frac{d}{dw}\tfrac12(y-wx)^2\Big|_{w_0}=(y-w_0x)(-x)=-e_0x=${f4(t.dJ[0])}`, why: tm('連鎖律：外層 $\\tfrac12u^2$ 的導數是 $u$，內層 $y-wx$ 的導數是 $-x$') },
            { tex: String.raw`\Delta w_0=-\mu J'(w_0)=-0.1\times(${f4(t.dJ[0])})=${f4(t.dw[0])}`, why: tm('斜率為負 $\\Rightarrow$ 往右（增加 $w$）走') },
            { tex: String.raw`w_1=w_0+\Delta w_0=1+${f4(t.dw[0])}=${f4(t.w[1])}`, why: '更新' },
            { tex: String.raw`e_1=6-${f4(t.w[1])}\times2=${f4(t.e[1])},\quad w_2=${f4(t.w[1])}+0.1\times${f4(t.e[1])}\times2=${f4(t.w[2])}`, why: '同樣的步驟再做一次（與 T01 的 1.8、2.28 相同）' },
          ]}
        />
        <p>
          注意 <Tex>{"-\\mu J'(w)=\\mu\\,e\\,x"}</Tex>：在固定 <Tex>{'x'}</Tex>、沒有雜訊時，對含 <Tex>{'\\tfrac12'}</Tex> 的成本做 gradient descent 和 LMS 的更新<strong>一模一樣</strong>。
          切線預測第一步後的成本為 <Tex>{String.raw`J(w_0)+J'(w_0)\Delta w_0=${f4(t.J[0])}+(${f4(t.dJ[0])})(${f4(t.dw[0])})=${f4(tanPred)}`}</Tex>，
          真實值卻是 <Tex>{String.raw`J(w_1)=${f4(t.J[1])}`}</Tex>——差的 <Tex>{String.raw`${f4(curvTerm)}=\tfrac12J''\Delta w^2=\tfrac12\cdot4\cdot${f4(t.dw[0])}^2`}</Tex> 正是切線沒算到的「彎曲」。下面的推導就是要處理它。
        </p>
      </Section>

      <Section kind="formula" title="為什麼負梯度會下降？（一階泰勒）">
        <Prereq title="泰勒展開（微積分回顧）">
          <p>
            在 <Tex>{'w'}</Tex> 附近，平滑函數可以寫成多項式：<Tex>{String.raw`J(w+\Delta)=J(w)+J'(w)\Delta+\tfrac12J''(w)\Delta^2+\tfrac16J'''(w)\Delta^3+\cdots`}</Tex>。
            <Tex>{'\\Delta'}</Tex> 很小時，<Tex>{'\\Delta^2'}</Tex> 比 <Tex>{'\\Delta'}</Tex> 小得多，所以只留前兩項就是「切線近似」。
            若 <Tex>{'J'}</Tex> 本身是二次函數（線性模型 + 平方誤差就是），三階以上導數全為 0，三項展開是<strong>精確</strong>的。
          </p>
        </Prereq>
        <DerivFold>
          <StepDerivation
            steps={[
              { tex: String.raw`J(w+\Delta)=J(w)+J'(w)\,\Delta+\tfrac12J''(w)\,\Delta^2+\cdots`, why: tm('在 $w$ 附近做泰勒展開') },
              { tex: String.raw`J(w+\Delta)\approx J(w)+J'(w)\,\Delta`, why: tm('$\\Delta$ 很小時二次項可忽略（切線近似）') },
              { tex: String.raw`\Delta=-\mu J'(w),\quad\mu>0`, why: tm('刻意選 $\\Delta$ 與斜率反號，讓一次項變成負的') },
              { tex: String.raw`J(w+\Delta)\approx J(w)-\mu\,[J'(w)]^2`, why: tm('代入 $\\Delta$') },
              { tex: String.raw`J(w+\Delta)\le J(w)\quad\text{（等號只在 }J'(w)=0\text{）}`, why: tm("平方不會是負的：只要還沒到谷底（$J'\\neq0$），一定往下") },
            ]}
            result={String.raw`w_{n+1}=w_n-\mu J'(w_n)`}
          />
        </DerivFold>
        <p>
          <ClaimTag kind="approx" /> 這只保證「<Tex>{'\\mu'}</Tex> 夠小」時會下降。步長能多大，要看二次項。
        </p>
      </Section>

      <Section kind="formula" title="步長上限：二次項（彎曲）把你推過頭">
        <DerivFold>
          <StepDerivation
            title={tm('二次成本的精確分析（固定 $x$、無雜訊）')}
            steps={[
              { tex: String.raw`J(w)=\tfrac12(y-wx)^2=\tfrac12x^2(a-w)^2`, why: tm('代入 $y=ax$：成本是 $w$ 的二次函數') },
              { tex: String.raw`J'(w)=-x^2(a-w),\qquad J''(w)=x^2`, why: tm("逐項微分；$J''$ 是常數（曲率）") },
              { tex: String.raw`J(w-\mu J')=J(w)-\mu J'^2+\tfrac12J''\mu^2J'^2`, why: '三項泰勒展開，對二次函數是精確式' },
              { tex: String.raw`=J(w)-\mu J'^2\Big(1-\tfrac{\mu}{2}J''\Big)`, why: tm("提出共同因子 $\\mu J'^2$") },
              { tex: String.raw`\text{下降}\iff 1-\tfrac{\mu}{2}J''>0\iff 0<\mu<\frac{2}{J''}`, why: '括號必須為正' },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.2">{String.raw`\boxed{J(w-\mu J')=J(w)-\mu J'^2\Big(1-\tfrac{\mu}{2}J''\Big)\;\Rightarrow\;0<\mu<\frac{2}{J''}}`}</TexBlock>
        <p>
          <ClaimTag kind="exact" /> 換成參數誤差 <Tex>{'\\delta_n=a-w_n'}</Tex>（全站極性）看更清楚：
        </p>
        <DerivFold>
          <StepDerivation
            steps={[
              { tex: String.raw`\delta_{n+1}=a-w_{n+1}=a-w_n+\mu J'(w_n)`, why: '代入更新式' },
              { tex: String.raw`=\delta_n+\mu\big(-J''\delta_n\big)`, why: tm("$J'(w)=-x^2(a-w)=-J''\\delta$") },
              { tex: String.raw`=(1-\mu J'')\,\delta_n\;\Rightarrow\;\delta_n=(1-\mu J'')^n\delta_0`, why: tm("等比數列：$|1-\\mu J''|<1$ 才會縮小") },
            ]}
          />
        </DerivFold>
        <p>
          <Tex>{'x=2'}</Tex> 時 <Tex>{"J''=x^2=4"}</Tex>：<Tex>{'0<\\mu<0.5'}</Tex>（T02；<Tex>{"p=1-\\mu J''"}</Tex> 叫做 pole，<a href="#/ch/03">Ch03</a> 詳細討論它的四種行為）。
          最快的是 <Tex>{"\\mu=1/J''=0.25"}</Tex>：一步就到 <Tex>{'a'}</Tex>，這就是 <strong>Newton 法</strong>（用曲率把步長正規化）——也是 §5 NLMS 的想法。
        </p>
        <HandCalcSlot id="HC-02.1">
          上面說「切線預測會下降 <Tex>{"\\mu J'^2"}</Tex>，實際只下降其中的 <Tex>{"1-\\tfrac{\\mu}{2}J''"}</Tex> 倍」。把 <Tex>{'a,\\ x,\\ w_0,\\ \\mu'}</Tex> 換成你自己的數字，
          先用紙筆把「切線預測的成本」和「真實的成本」各算一次，再展開步驟對答案（預設就是上面「先算一次」的數字）。
        </HandCalcSlot>
        <Callout kind="warn" title={<><Tex>{'\\tfrac12'}</Tex> 不是裝飾 <ErrataNote id="E41" /></>}>
          <p>
            規格 §1 原寫 <Tex>{'J_2(w)=E[(y-wx)^2]'}</Tex>（沒有 <Tex>{'\\tfrac12'}</Tex>），§1.1 的單筆成本卻是 <Tex>{'\\tfrac12e^2'}</Tex>。兩者的梯度差 2 倍：
          </p>
          <TexBlock>{String.raw`\frac{dJ_2}{dw}=-2E[e\,x],\qquad J_2''=2P_x\;\Rightarrow\;\text{對 }J_2\text{ 做 GD 的步長界為 }0<\mu<\frac{1}{P_x}`}</TexBlock>
          <p>
            所以 LMS 的 <Tex>{'w+\\mu ex'}</Tex> 等於對 <Tex>{'J_2'}</Tex> 以步長 <Tex>{'\\mu/2'}</Tex> 做 SGD。本站一律採用 <Tex>{'J=\\tfrac12E[e^2]'}</Tex>，切線斜率與實際更新量同一個 scaling（argmin 不變）。
            下方實驗可以切換兩種 scaling 親眼看到步長加倍。
          </p>
        </Callout>
      </Section>

      <Section kind="explore" title="動手觀察">
        <GdExplorer />
      </Section>

      <ModeGate min="engineer">
        <Derivation
          title="程式碼：gradientDescent()（上方實驗實際執行的就是這段）"
          formulaId="F-02.1"
          level="L0"
          claim="exact"
          derivation={<CodeBlock source={sgdSrc} region="gradientDescent" path="src/simulation/models/sgd.ts" caption={String.raw`$c=\tfrac12$ 時 $J'=-e\,x$、$\Delta w=\mu\,e\,x$，與 lms.ts 的 conventionalStep 逐位元相同（T01 測試）。`} />}
          assumptions={['固定 $x$、無雜訊', String.raw`成本 $J=c\,e^2$，$c\in\{\tfrac12,\,1\}$`]}
        />
      </ModeGate>

      <Quiz
        title="思考題 1（步長上限）"
        question={
          <>
            固定 <Tex>{'x=3'}</Tex>、無雜訊，成本 <Tex>{'J=\\tfrac12(y-wx)^2'}</Tex>。下列哪一個 <Tex>{'\\mu'}</Tex> 會讓 gradient descent <strong>一步到位</strong>？
          </>
        }
        options={[{ label: <Tex>{'\\mu=2/9'}</Tex> }, { label: <Tex>{'\\mu=1/9'}</Tex>, correct: true }, { label: <Tex>{'\\mu=1/3'}</Tex> }, { label: <Tex>{'\\mu=1/18'}</Tex> }]}
        answer={
          <>
            <Tex>{"J''=x^2=9"}</Tex>，<Tex>{"\\delta_{n+1}=(1-9\\mu)\\delta_n"}</Tex>。一步到位要 <Tex>{'1-9\\mu=0\\Rightarrow\\mu=1/9'}</Tex>（Newton 步長）。
            <Tex>{'\\mu=2/9'}</Tex> 是穩定邊界（<Tex>{'p=1-9\\mu=-1'}</Tex>，永遠來回跳）；<Tex>{'1/3'}</Tex> 已經發散（<Tex>{'p=-2'}</Tex>）；
            若有人用沒有 <Tex>{'\\tfrac12'}</Tex> 的 <Tex>{'J_2'}</Tex>，會誤算成 <Tex>{'1/18'}</Tex>（E41）。
          </>
        }
      />
    </section>
  )
}
