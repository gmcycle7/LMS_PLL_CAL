import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, Prereq, Section, StepDerivation, Tex, TexBlock, ChRef, ChapterErratum } from '@/components'
import biasSrc from '@/simulation/models/bias.ts?raw'
import { buildCodeDistribution, codeMoments, comparatorMean } from '@/simulation/models/bias'
import { F } from '../formulas'
import { m, texNum } from '../common'
import { Fig, FigRef } from '../Fig'

/** §11 誤差模型、逐項表、三類雜訊、先備知識。 */
export function ModelSection() {
  const mo5 = useMemo(() => codeMoments(buildCodeDistribution({ kind: 'five_level' })), [])
  const moU = useMemo(() => codeMoments(buildCodeDistribution({ kind: 'uniform_residue' })), [])
  const eq = comparatorMean(1, 100)
  return (
    <Section kind="formula" title="11.0 總誤差模型：把每一項拆開看" level={2} id="ch11-model">
      <p>
        把 comparator 前的誤差 —— 也就是 PD 的輸出 <Tex>{'e[n]'}</Tex>，送進 loop filter 的同一個節點 —— 寫成五項的和（PLL 的動態先吸收進誤差路徑，用靜態式表達；§11.4 再把 PLL 濾波加回來）。先看 <FigRef id="error-budget" />{' '}
        的左邊：code <Tex>{'x[n]'}</Tex> 分出三條路 —— gain 誤差、INL、code-correlated 干擾 —— 這三項都是 <Tex>{'x'}</Tex> 的函數；另外兩個來源（offset
        與雜訊）不經過 <Tex>{'x'}</Tex>。再看中間的加法點：五項全部以正號相加，和就是 <Tex>{'e[n]'}</Tex>，之後才進 comparator 與 GMAC。
      </p>
      <Fig id="error-budget" />
      <p>
        圖上進加法點的五個方塊，就是下面公式等號右邊的五項（公式由左到右：藍色的 gain 誤差、offset、紅色的 INL 與干擾、綠色的雜訊）：
      </p>
      <TexBlock id="F-11.1" label={m('總誤差模型（時間索引 $n$ = comparator sample）')}>
        {F.errorModel}
      </TexBlock>
      <p>
        逐項讀一次符號：<Tex>{'a-w'}</Tex> 是真實 gain 減去校正 gain（全站的 gain 誤差 <Tex>{'\\delta=a-w'}</Tex>）—— feedback edge 早到{' '}
        <Tex>{'a\\,x'}</Tex>、reference 端的 DTC 只補了 <Tex>{'w\\,x'}</Tex>，PD 看到的就是兩者的差 <Tex>{'(a-w)\\,x'}</Tex>；<Tex>{'b'}</Tex> 是 PD／comparator
        的靜態 offset；<Tex>{'d(x)'}</Tex> 是 DTC 的 INL（延遲偏離直線的量：正的 <Tex>{'d'}</Tex> 表示這個 code 的 reference edge 比直線晚{' '}
        <Tex>{'d(x)'}</Tex>），<Tex>{'c_2'}</Tex>、<Tex>{'c_3'}</Tex> 分別是它的二階與三階係數；
        <Tex>{String.raw`\varepsilon_{cc}[n]=\kappa\,x[n]`}</Tex> 是與 code 成正比的確定性干擾，<Tex>{'\\kappa'}</Tex> 是耦合係數；<Tex>{'v[n]'}</Tex>{' '}
        是與 code 獨立、零均值的隨機雜訊，它的標準差記作 <Tex>{'\\sigma_v'}</Tex>。
      </p>
      <p className="small">
        <ChapterErratum id="E12" note="§11 的 $u[n]$ 與 §0 的 filtered regressor $u=h*x$ 撞名" />
        規格書 §11 把干擾寫成 <Tex>{'u[n]'}</Tex>，但全站 §0 的 <Tex>{'u[n]=(h*x)[n]'}</Tex> 是經過 PLL 誤差路徑的有效 regressor，兩者不能混用。本章改名為{' '}
        <Tex>{String.raw`\varepsilon_{cc}[n]`}</Tex>（code-correlated disturbance），係數改用 <Tex>{'\\kappa'}</Tex>；三階 INL 係數統一寫成 <Tex>{'c_3'}</Tex>
        （與 §19 Lab 控制項一致）。
      </p>

      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>項</th>
              <th>物理來源（硬體）</th>
              <th>
                和 <Tex>{'x'}</Tex> 相關？
              </th>
              <th>
                會讓 <Tex>{'w^*\\neq a'}</Tex>？
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Tex>{'(a-w)\\,x[n]'}</Tex>
              </td>
              <td>DTC gain 不對（我們真正想校正的量）</td>
              <td>{m('是（就是 $x$ 的倍數）')}</td>
              <td>{m('這一項把 $w$ 拉向 $a$')}</td>
            </tr>
            <tr>
              <td>
                <Tex>{'b'}</Tex>
              </td>
              <td>PD / comparator 的靜態 offset、threshold 誤差</td>
              <td>{m('常數，與 $x$ 無關')}</td>
              <td>
                只在 <Tex>{'E[x]\\neq0'}</Tex> 且主迴路沒有把 DC 消掉時（§11.1、勘誤 E03）
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{String.raw`d(x)=c_2x^2+c_3x^3`}</Tex>
              </td>
              <td>DTC INL、code-dependent delay</td>
              <td>{m('是（$x$ 的確定函數）')}</td>
              <td>
                會：<Tex>{String.raw`E[x\,d(x)]/E[x^2]`}</Tex>（§11.2）
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{String.raw`\varepsilon_{cc}=\kappa x`}</Tex>
              </td>
              <td>DSM pattern 經 supply / clock phase 耦合到 PD 的確定性誤差</td>
              <td>是</td>
              <td>
                會，而且和 gain 分不開：<Tex>{'w^*=a+\\kappa'}</Tex>（§11.3）
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'v[n]'}</Tex>
              </td>
              <td>thermal noise、random jitter、comparator noise</td>
              <td>
                與 <Tex>{'x'}</Tex> 獨立、零均值
              </td>
              <td>
                本身不會；只造成 <Tex>{'w'}</Tex> 的隨機抖動（<ChRef ch="12">Ch12</ChRef>），並決定 comparator 的小訊號增益{' '}
                <Tex>{String.raw`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex>（平均輸出對輸入的斜率，§11.A 推導）。但 Sign-LMS 的 <Tex>{'\\sigma_v'}</Tex> 大小會改變其他 bias
                最後落在哪裡（例如三階 INL 的 1.34 ↔ 1.4，§11.2、勘誤 E01）
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <CodeBlock
        source={biasSrc}
        region="errorModel"
        path="src/simulation/models/bias.ts"
        title="誤差模型的程式碼：本章所有圖表、表格與 Lab 都呼叫這兩個函式"
        caption={String.raw`eDet 就是確定性誤差 $e_\mathrm{det}(x;w)$；sigmaAt 是 comparator 前雜訊的標準差（$\rho_j>0$ 時隨 code 改變；$\sigma_\mathrm{extra}$ 見 §11.1 的 servo 抖動）。`}
      />
      <p>
        把確定性的部分合起來記作 <Tex>{String.raw`e_\mathrm{det}(x;w)=(a-w)x+b+d(x)+\varepsilon_{cc}(x)`}</Tex>，則 <Tex>{String.raw`e=e_\mathrm{det}+v`}</Tex>
        。以下所有時間量都用同一個正規化單位 <Tex>{'\\mathrm{t.u.}'}</Tex>（例如 <Tex>{'1\\,\\mathrm{t.u.}=1\\,\\mathrm{fs}'}</Tex> 或 1 DTC LSB），code <Tex>{'x'}</Tex> 無因次。
      </p>

      <h3>三類「雜訊」會不會造成 bias？</h3>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>類別</th>
              <th>例子</th>
              <th>對 GMAC 的影響</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>① 與 code 無關的零均值隨機雜訊</td>
              <td>
                <Tex>{'v[n]'}</Tex>：thermal、comparator noise
              </td>
              <td>
                <Tex>{String.raw`E[x\,v]=E[x]E[v]=0`}</Tex>
              </td>
              <td>
                <strong>不造成 bias</strong>，只讓 <Tex>{'w'}</Tex> 抖動（<Tex>{'\\sigma_w'}</Tex>，<ChRef ch="12">Ch12</ChRef>）
              </td>
            </tr>
            <tr>
              <td>② 與 code 相關的確定性誤差</td>
              <td>
                <Tex>{'d(x)'}</Tex>、<Tex>{String.raw`\varepsilon_{cc}=\kappa x`}</Tex>
              </td>
              <td>
                <Tex>{String.raw`E[x\,d]`}</Tex>、<Tex>{String.raw`E[x\,\varepsilon_{cc}]`}</Tex> 通常 <Tex>{'\\neq0'}</Tex>
              </td>
              <td>
                只要與 <Tex>{'x'}</Tex> 的相關不為 0 就<strong>造成 bias</strong>（可預測、可重複，平均再久也不會消失）。例外：對稱 code 下的偶次 INL（<Tex>{'E[x\\cdot x^2]=0'}</Tex>）
              </td>
            </tr>
            <tr>
              <td>③ 靜態 offset</td>
              <td>
                <Tex>{'b'}</Tex>
              </td>
              <td>
                <Tex>{String.raw`E[x\,b]=b\,E[x]`}</Tex>
              </td>
              <td>
                <Tex>{'E[x]\\neq0'}</Tex> 且 DC 未被消除時造成 bias
              </td>
            </tr>
            <tr>
              <td>④ 隨 code 改變大小的隨機 jitter</td>
              <td>
                <Tex>{String.raw`\sigma_v=\sigma_v(x)`}</Tex>：DTC random jitter 隨 delay 增加
              </td>
              <td>
                Sign-LMS 的局部增益 <Tex>{String.raw`K_q(x)=\sqrt{2/\pi}/\sigma_v(x)`}</Tex> 隨 code 變
              </td>
              <td>
                本身不造成 bias，但會<strong>重新加權</strong>②③（使 centering 失效）<ChapterErratum id="E17" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Prereq title={String.raw`期望值 $E[\cdot]$：「很多次的平均」`}>
        <p>
          若 <Tex>{'x'}</Tex> 取值 <Tex>{'x_1,\\dots,x_K'}</Tex>，機率 <Tex>{'p_1,\\dots,p_K'}</Tex>（白話：做很多次實驗，每次抽一個 <Tex>{'x'}</Tex>，<Tex>{'f(x)'}</Tex> 的長期平均），則
        </p>
        <TexBlock>{String.raw`E[f(x)]=\sum_{i=1}^{K}p_i\,f(x_i)\qquad(\text{連續分布：}E[f(x)]=\int f(x)\,p(x)\,dx)`}</TexBlock>
        <p>
          例：5-level code 每個機率 <Tex>{'1/5'}</Tex>，<Tex>{String.raw`E[x^2]=\tfrac15(4+1+0+1+4)=${texNum(mo5.Ex2)}`}</Tex>、
          <Tex>{String.raw`E[x^4]=\tfrac15(16+1+0+1+16)=${texNum(mo5.Ex4)}`}</Tex>。期望值是<strong>線性</strong>的：<Tex>{String.raw`E[\alpha f+\beta g]=\alpha E[f]+\beta E[g]`}</Tex>
          ，這是本章每一步推導最常用的性質。
        </p>
      </Prereq>
      <Prereq title="變異數、共變異數與「相關」">
        <TexBlock>{String.raw`\operatorname{Var}(x)=E\big[(x-E[x])^2\big]=E[x^2]-E[x]^2,\qquad \operatorname{Cov}(x,y)=E[xy]-E[x]E[y]`}</TexBlock>
        <p>
          <Tex>{'E[xy]'}</Tex> 叫做 <Tex>{'x'}</Tex> 與 <Tex>{'y'}</Tex> 的<strong>相關（correlation）</strong>：兩者同號的時候多，它就是正的。GMAC 硬體算的正是{' '}
          <Tex>{'E[q\\,x]'}</Tex> 的估計。當 <Tex>{'E[x]=0'}</Tex>（code 已置中）時相關等於共變異數。例：uniform <Tex>{'[0,1)'}</Tex> residue 的{' '}
          <Tex>{String.raw`E[x^2]=${texNum(moU.Ex2, 5)}=1/3`}</Tex>，但 <Tex>{String.raw`\operatorname{Var}(x)=${texNum(moU.varX, 5)}=1/12`}</Tex> —— 差 4 倍，§11.1 會用到。
        </p>
        <p>
          <strong>獨立</strong>時 <Tex>{'E[xy]=E[x]E[y]'}</Tex>，所以零均值雜訊 <Tex>{'v'}</Tex> 與 code 獨立就有 <Tex>{'E[xv]=0'}</Tex>。
        </p>
        <p className="small">
          用語：<Tex>{'E[xy]=0'}</Tex> 叫做 <Tex>{'x'}</Tex> 與 <Tex>{'y'}</Tex> <strong>正交（orthogonal）</strong>；<strong>不相關（uncorrelated）</strong>是另一件事，指共變異數為
          0，也就是 <Tex>{'E[xy]=E[x]\\,E[y]'}</Tex>（<a href="#/ch/00">Ch00</a> §0.7、<a href="#/ch/01">Ch01</a> §1.2.1）。只要其中一個量的平均是 0，兩者就相同。GMAC
          累加的是乘積本身，不會先扣掉平均，所以「GMAC 歸零」檢查的是正交。例：常數 offset <Tex>{'b'}</Tex> 與 code 的共變異數永遠是 0，但{' '}
          <Tex>{'E[x\\,b]=b\\,E[x]'}</Tex> 只有在 <Tex>{'E[x]=0'}</Tex>（或 <Tex>{'b=0'}</Tex>）時才是 0 —— §11.1 的 offset bias 就是這樣來的。
        </p>
      </Prereq>
      <Prereq title={String.raw`Gaussian、$\Phi$ 與 $\operatorname{erf}$：comparator 的機率`}>
        <p>
          <Tex>{String.raw`v\sim\mathcal N(0,\sigma_v^2)`}</Tex> 表示 <Tex>{'v'}</Tex> 是平均 0、標準差 <Tex>{'\\sigma_v'}</Tex> 的鐘形分布。累積機率{' '}
          <Tex>{String.raw`\Phi(z)=P(v/\sigma_v\le z)`}</Tex>，以及 error function
        </p>
        <TexBlock>{String.raw`\operatorname{erf}(z)=\frac{2}{\sqrt\pi}\int_0^z e^{-t^2}dt,\qquad 2\Phi(z)-1=\operatorname{erf}\!\big(z/\sqrt2\big)`}</TexBlock>
        <p>
          泰勒展開（只用微積分）：<Tex>{String.raw`e^{-t^2}=1-t^2+\tfrac{t^4}{2}-\cdots`}</Tex> 逐項積分得{' '}
          <Tex>{String.raw`\operatorname{erf}(z)=\tfrac{2}{\sqrt\pi}\big(z-\tfrac{z^3}{3}+\tfrac{z^5}{10}-\cdots\big)`}</Tex>。這個級數對任何有限的{' '}
          <Tex>{'z'}</Tex> 都收斂；但只取前一、兩項時，只有 <Tex>{'|z|'}</Tex> 小才準（§11.2 的表會看到 <Tex>{'|z|'}</Tex> 大時三次截斷完全失準）。第一項就是 comparator 的小訊號增益
          <Tex>{'K_q'}</Tex>，第二項（三次項）決定 Sign-LMS 固定點的修正（§11.2）。例：<Tex>{String.raw`s=1,\ \sigma_v=100`}</Tex> 時{' '}
          <Tex>{String.raw`E[q]=\operatorname{erf}(0.01/\sqrt2)=${texNum(eq, 8)}`}</Tex>（<ChRef ch="05">Ch05</ChRef>）。
        </p>
      </Prereq>
      <Prereq title="條件期望與「先固定 $x$ 再平均」（tower property）">
        <p>
          <Tex>{'E[q\\mid x]'}</Tex> 表示「code 固定為 <Tex>{'x'}</Tex> 時，對雜訊 <Tex>{'v'}</Tex> 取平均」。再對 <Tex>{'x'}</Tex> 平均一次就得到總平均：
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`E[q\,x]=\sum_i p_i\,x_i\,E[q\mid x=x_i]`, why: '先在每個 code 上對雜訊取平均，再以 code 的機率加權。' },
            { tex: String.raw`=E\big[x\,E[q\mid x]\big]`, why: '把上式寫成期望值的形式（離散與連續都成立）。' },
          ]}
        />
      </Prereq>
      <Callout kind="info" title="本章的模型層級與標籤">
        靜態誤差路徑、iid code、Gaussian <Tex>{'v'}</Tex> 的固定點屬於 L1；加上主 PLL DC null 的 servo 為 L2。MSE-LMS 的固定點是一次方程，標{' '}
        <ClaimTag kind="exact" />；Sign-LMS 的 mean-field 根在指定模型中也是精確的，但「1.34 類的封閉公式」只是一階近似，標 <ClaimTag kind="approx" />。
      </Callout>
    </Section>
  )
}
