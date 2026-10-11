import { Callout, Prereq, Section, StepDerivation, Tex, TexBlock, mathText } from '@/components'
import { kqGain, toySignLmsStep } from '@/simulation/models/sspll'
import { SIM_CFG, WORKED } from '../data'
import { Claim, DataTable, Diagram, FigRef, Formula, Hand, fx, r, txs } from '../common'

/** 玩具模型：sign-error LMS，PD 看到 e = g·(a − w)·x（g = +1：沒有迴路；g = −0.2：反相縮小）。每一步都是 sspll.ts 的 toySignLmsStep（HC-CS.1 用同一個函式） */
function toy(g: number, steps = 5, a = 1, mu = 0.1, x = 1): { w: number[]; q: number[] } {
  const w = [0]
  const q: number[] = []
  for (let i = 0; i < steps - 1; i++) {
    const s = toySignLmsStep(w[i], a, x, mu, g)
    q.push(s.q)
    w.push(s.w)
  }
  return { w, q }
}

/** §4 LMS 的平均更新：為什麼是 Re H_PD 決定符號。 */
export function S04MeanUpdate() {
  const A = toy(1)
  const B = toy(-0.2)
  const sigFs = SIM_CFG.sigmaPs * 1000
  const Kq = kqGain(sigFs)
  // golden 的手算表與這裡的玩具模型一致（顯示時以即時計算為準）
  const consistent = A.w.every((v, i) => Math.abs(v - WORKED['e_H=+1'][i]) < 1e-12) && B.w.every((v, i) => Math.abs(v - WORKED['e_H=-0.2'][i]) < 1e-12)
  return (
    <Section kind="formula" level={2} title="4. LMS 的平均更新：為什麼是 $\mathrm{Re}\,H_{PD}$ 決定符號" id="cs-4">
      <h3>4.1 一個問題，先算一次</h3>
      <p>
        <strong>黑盒子例子</strong>：你只能看到比較器輸出 <Tex>{r`q=\mathrm{sign}(e)`}</Tex>，不知道真值 <Tex>{'a=1'}</Tex>。估計 <Tex>{'w'}</Tex> 從 0 開始，取 <Tex>{r`\mu=0.1`}</Tex>、<Tex>{'x=1'}</Tex>，每一步{' '}
        <Tex>{r`w\leftarrow w+\mu\,q\,x`}</Tex>。
      </p>
      <ul>
        <li>
          情況 A：沒有迴路，<Tex>{'e=(a-w)x'}</Tex>。
        </li>
        <li>
          情況 B：PD 看到的是被迴路「反相縮小」的殘差 <Tex>{r`e=-0.2\,(a-w)x`}</Tex>。這是一個單 tap 的玩具模型，代表 <Tex>{r`\mathrm{Re}\,H<0`}</Tex>。
        </li>
      </ul>
      <Diagram id="toy" />
      <p>
        兩列的方塊一模一樣，只有第二格不同：把兩種情況合寫成 <Tex>{r`e=g\,(a-w)\,x`}</Tex>。圖上第一格是還沒校掉的誤差 <Tex>{r`\delta\,x`}</Tex>（<Tex>{r`\delta=a-w`}</Tex> 是「真值 − 估計」），「× g」就是式子裡的 <Tex>{'g'}</Tex>（A 是 <Tex>{'+1'}</Tex>，B 是 <Tex>{'-0.2'}</Tex>），第三格的{' '}
        <Tex>{r`e=g\,\delta\,x`}</Tex> 就是 PD 看到的殘差。先看 A 列：<Tex>{'q'}</Tex> 和 <Tex>{r`\delta\,x`}</Tex> 同號，所以更新量 <Tex>{r`\mu\,q\,x`}</Tex> 和 <Tex>{r`\delta`}</Tex> 同號，把 <Tex>{'w'}</Tex> 推向 <Tex>{'a'}</Tex>。再看 B 列：紅色那一格把符號翻過來，後面的 sign
        與更新照做，結果每一步都走錯方向。下表就是照這兩列各走四步的結果。
      </p>
      <DataTable
        className="cs-num"
        head={['步', <>A：<Tex>{'w'}</Tex></>, <>A：<Tex>{'q'}</Tex></>, <>B：<Tex>{'w'}</Tex></>, <>B：<Tex>{'q'}</Tex></>]}
        rows={A.w.map((_, i) => [String(i), fx(A.w[i], 1), i < A.q.length ? (A.q[i] > 0 ? '+1' : '−1') : '', fx(B.w[i], 1), i < B.q.length ? (B.q[i] > 0 ? '+1' : '−1') : ''])}
        caption={consistent ? '由本頁即時計算；與 golden 的 worked_examples.json 逐點相同。' : '由本頁即時計算。'}
      />
      <p>
        A 往 <Tex>{'a=1'}</Tex> 前進；B 每一步都往反方向走，而且離真值越遠，<Tex>{'q'}</Tex> 越肯定是 −1，所以會一直走下去。這就是「反號、不收斂」。注意 B 的增益只有 0.2——<strong>反號和增益大小無關，只和符號有關</strong>；把{' '}
        <Tex>{r`\mu`}</Tex> 縮小十倍只會讓它慢十倍走到同一個錯的方向。剩下的問題是：真正的迴路什麼時候會變成情況 B？
      </p>
      <Hand id="HC-CS.1">{r`表格是情況 B（$g=-0.2$）。把 $g$、$\mu$、$w_0$ 換成你自己的數字，先用紙筆走四步，再對答案——特別試試「只改 $\lvert g\rvert$、不改符號」。`}</Hand>

      <h3>4.2 一步一步推導平均梯度</h3>
      <Prereq title="期望值、變異數、高斯分布、erf、時間平均、相關">
        <ul>
          <li>
            <strong>期望值</strong> <Tex>{'E[X]'}</Tex>：隨機變數 <Tex>{'X'}</Tex> 的長期平均。若 <Tex>{'X'}</Tex> 有機率密度 <Tex>{'p(x)'}</Tex>，則 <Tex>{r`E[X]=\int x\,p(x)\,dx`}</Tex>。
          </li>
          <li>
            <strong>變異數（variance）</strong> <Tex>{r`\mathrm{var}(X)=E[(X-E[X])^2]`}</Tex>：偏離平均的平方的平均，也就是「去掉 DC 之後的功率」；它的平方根是標準差 <Tex>{r`\sigma`}</Tex>。例：在 <Tex>{'[0,1)'}</Tex> 上均勻分布的量（後面的鋸齒{' '}
            <Tex>{r`\rho`}</Tex> 就是）平均是 <Tex>{r`\tfrac12`}</Tex>，變異數是 <Tex>{r`\int_0^1(x-\tfrac12)^2dx=\tfrac1{12}`}</Tex>。
          </li>
          <li>
            <strong>高斯分布</strong> <Tex>{r`v\sim\mathcal N(0,\sigma^2)`}</Tex>：<Tex>{r`p(v)=\frac{1}{\sqrt{2\pi}\sigma}e^{-v^2/2\sigma^2}`}</Tex>。
          </li>
          <li>
            <strong>erf</strong>：<Tex>{r`\mathrm{erf}(x)=\frac{2}{\sqrt\pi}\int_0^x e^{-t^2}dt`}</Tex>，奇函數，<Tex>{r`\mathrm{erf}(x)\approx\frac{2}{\sqrt\pi}x`}</Tex>（<Tex>{'x'}</Tex> 小時，泰勒一階）。
          </li>
          <li>
            <strong>時間平均</strong>：<Tex>{r`\langle y\rangle=\lim_{M\to\infty}\frac1M\sum_{n=1}^{M}y[n]`}</Tex>。對週期或「幾乎週期」的訊號，它就是長期平均。
          </li>
          <li>
            <strong>相關（correlation）</strong>：<Tex>{r`\langle r\,y\rangle`}</Tex> 衡量兩個訊號「同向」的程度。同向時為正，反向時為負，無關時為 0。
          </li>
        </ul>
      </Prereq>
      <p>
        真正的校正迴路比玩具模型多三樣東西：誤差要先通過主迴路 <Tex>{r`H_{PD}`}</Tex>；比較器的輸入多了雜訊 <Tex>{'v[n]'}</Tex>（高斯，標準差 <Tex>{r`\sigma_v`}</Tex>）；而且權重不是每拍更新，是把 <Tex>{'N'}</Tex> 拍的 <Tex>{r`q\cdot r`}</Tex> 平均成一個數{' '}
        <Tex>{'G_i[k]'}</Tex>（<strong>GMAC</strong> 的輸出，<Tex>{'k'}</Tex> 是 block 索引），再乘上步長 <Tex>{r`\mu`}</Tex> 累加進權重。
      </p>
      <Diagram id="lms-loop" />
      <p>
        先看標著「快」的框（每個 sample 做一次）：權重誤差 <Tex>{r`\delta_j`}</Tex> 乘上 regressor <Tex>{'x_j[n]'}</Tex> 成為注入的誤差 <Tex>{'u[n]'}</Tex>，通過 <Tex>{r`H_{PD}`}</Tex>、加上雜訊、取 sign 得到 <Tex>{'q[n]'}</Tex>，再乘上 GMAC 用的 regressor <Tex>{'r_i[n]'}</Tex>。
        <Tex>{'r_i'}</Tex> 是 <Tex>{'x_i'}</Tex> 通過前置濾波 <Tex>{'G(z)'}</Tex> 的結果；不做任何處理（raw）時 <Tex>{'G=1'}</Tex>、<Tex>{'r_i=x_i'}</Tex>，§11 的對策就是換這一格。再看標著「慢」的框（每個 block 做一次）：平均、乘 <Tex>{r`\mu`}</Tex>、累加，新的權重回到最前面，形成迴圈。兩個藍色方塊（
        <Tex>{r`H_{PD}`}</Tex> 與 <Tex>{'G'}</Tex>）一個在「誤差這一側」、一個在「regressor 這一側」，它們的相位差決定了相乘之後的平均是正是負。
      </p>
      <p>
        下面的推導要做的事，就是把這個又有 sign、又有兩種速率的迴圈，平均成一個只在 block rate 運作的線性迴圈：
      </p>
      <Diagram id="mean-loop" />
      <p>
        先看迴圈本身：只剩一個延遲（一個 block）、一個矩陣 <Tex>{'C'}</Tex> 和兩個增益。圖上的 <Tex>{'C'}</Tex> 方塊就是推導第 6 步定義的 <Tex>{r`C_{ij}=\langle r_i\,(h_{PD}*x_j)\rangle`}</Tex>，它把 <FigRef id="lms-loop" /> 裡的 <Tex>{r`H_{PD}`}</Tex>、<Tex>{'G'}</Tex> 與 regressor
        全部收進去；「× <Tex>{'K_q'}</Tex>」是第 3 步把比較器線性化之後的等效增益；加法點上的「−」就是第 7 步 <Tex>{r`\delta_{k+1}=\delta_k-\mu K_q C\,\delta_k`}</Tex> 的負號。再看虛線指到的說明：沿 <Tex>{'C'}</Tex> 的每個特徵方向，這個迴圈每個 block 把誤差乘上{' '}
        <Tex>{r`1-\mu K_q\lambda`}</Tex>（<Tex>{r`\lambda`}</Tex> 是 <Tex>{'C'}</Tex> 在那個方向的特徵值，推導後面的先備知識框有說明），所以收不收斂只看 <Tex>{r`\lambda`}</Tex> 的實部是正是負。
      </p>
      <StepDerivation
        title="一步一步：從 1-bit 比較器到平均更新"
        steps={[
          { tex: r`E[q\mid e]=P(e+v>0)-P(e+v<0)`, why: <><Tex>{'q'}</Tex> 是 <Tex>{r`\pm1`}</Tex>，期望值等於「為正的機率減去為負的機率」。</> },
          { tex: r`=\mathrm{erf}\!\left(\frac{e}{\sqrt2\,\sigma_v}\right)`, why: <><Tex>{'v'}</Tex> 是高斯，<Tex>{'P(v>-e)-P(v<-e)'}</Tex> 正好寫成 erf。</> },
          {
            tex: r`\approx\sqrt{\tfrac{2}{\pi}}\frac{e}{\sigma_v}\;=\;K_q\,e`,
            why: (
              <>
                Bussgang 線性化：<Tex>{r`\lvert e\rvert\ll\sigma_v`}</Tex> 時取 erf 的泰勒一階。例：<Tex>{`\\sigma_v=${fx(sigFs, 0)}`}</Tex> fs 時 <Tex>{`K_q=${txs(Kq, 4)}\\ \\mathrm{fs}^{-1}`}</Tex>。
              </>
            ),
          },
          { tex: r`E[G_i]=E\Big[\tfrac1N\textstyle\sum_n q[n]\,r_i[n]\Big]\approx K_q\,\langle r_i\,e_{PD}\rangle`, why: '一個 block 的 GMAC 輸出取期望，代入上一步。block 夠長時，樣本平均可以換成時間平均。' },
          {
            tex: r`e_{PD}=h_{PD}*\Big(\textstyle\sum_j \delta_j\,x_j\Big)=\textstyle\sum_j \delta_j\,(h_{PD}*x_j)`,
            why: <>理想模型下的殘差：每個權重誤差 <Tex>{r`\delta_j`}</Tex> 乘上它的 regressor，再通過迴路。LTI 系統可以逐項通過。</>,
          },
          { tex: r`E[G_i]\approx K_q\textstyle\sum_j \underbrace{\langle r_i\,(h_{PD}*x_j)\rangle}_{C_{ij}}\,\delta_j = K_q\,(C\delta)_i`, why: <>把上一步代入，定義矩陣 <Tex>{'C'}</Tex>。</> },
          { tex: r`\delta_{k+1}=\delta_k-\mu K_q\,C\,\delta_k`, why: <>權重更新 <Tex>{r`w\leftarrow w+\mu G`}</Tex>，而 <Tex>{r`\delta=`}</Tex> 真值 − <Tex>{'w'}</Tex>，所以 <Tex>{r`\delta`}</Tex> 減少 <Tex>{r`\mu E[G]`}</Tex>。</> },
        ]}
      />
      <Formula id="F-CS.2" />
      <p>
        <strong>收斂條件</strong>：最後一步是線性遞迴，沿 <Tex>{'C'}</Tex> 的每個特徵方向，誤差每個 block 乘上 <Tex>{r`1-\mu K_q\lambda`}</Tex>。所以：
      </p>
      <TexBlock>{r`\boxed{\ \text{小 }\mu\text{ 時，平均收斂}\iff \mathrm{Re}\,\mathrm{eig}(C)>0\ \text{（在可觀測子空間）}\ }`}</TexBlock>
      <p>
        <Claim kind="exact">指 Bussgang 線性化與穩態平均下</Claim>
        若某個 eigenvalue 的實部 <Tex>{'<0'}</Tex>，那個方向的誤差會指數成長，這就是反號。這裡說的是「平均收斂」（mean convergence）；有限步長的條件更嚴（§12），大訊號與比較器 offset 另外處理（§10、§13）。
      </p>
      <Prereq title="矩陣、特徵值、可觀測子空間">
        <ul>
          <li>
            <strong>特徵值（eigenvalue）</strong>：<Tex>{r`Cv=\lambda v`}</Tex> 的 <Tex>{r`\lambda`}</Tex>。對應的特徵向量 <Tex>{'v'}</Tex> 是一個「方向」：沿這個方向的誤差，每一步只被乘上 <Tex>{r`1-\mu K_q\lambda`}</Tex>，不會轉到別的方向。
          </li>
          <li>
            實數矩陣的特徵值可能是複數。這時誤差會一邊旋轉一邊放大或縮小，決定放大或縮小的是 <Tex>{r`\mathrm{Re}\,\lambda`}</Tex>。
          </li>
          <li>
            <strong>可觀測子空間</strong>：如果某個方向的 regressor 恆為 0（例如 <Tex>{r`\alpha=k/8`}</Tex> 時 <Tex>{r`\rho\equiv0`}</Tex>），或者是 PHOS 的共模（8 個權重一起加同一個常數），PD 就看不到它，GMAC
            也不會更新它。這些方向的特徵值是 0，與收斂無關，要先剔除。
          </li>
        </ul>
      </Prereq>

      <h3>
        4.3 頻域：<Tex>{'C'}</Tex> 是「regressor 功率對 <Tex>{r`\mathrm{Re}\,\Gamma`}</Tex> 的加權平均」
      </h3>
      <Prereq title="DFT／Fourier 級數、Parseval、PSD">
        <ul>
          <li>
            週期為 <Tex>{'Q'}</Tex> 的序列可以寫成 <Tex>{'Q'}</Tex> 個複弦波的和：<Tex>{r`x[n]=\sum_{\ell=0}^{Q-1}c_\ell\,e^{j2\pi\ell n/Q}`}</Tex>，<Tex>{r`c_\ell=\frac1Q\sum_n x[n]e^{-j2\pi\ell n/Q}`}</Tex>。這就是{' '}
            <strong>DFT</strong>；每個 <Tex>{r`c_\ell`}</Tex> 稱為一條「譜線」，頻率 <Tex>{r`f_\ell=\ell/Q`}</Tex>。
          </li>
          <li>
            <strong>Parseval</strong>：<Tex>{r`\langle\lvert x\rvert^2\rangle=\sum_\ell\lvert c_\ell\rvert^2`}</Tex>。訊號的總功率等於各譜線功率的和。
          </li>
          <li>
            <strong>PSD（功率頻譜密度）</strong>：<Tex>{r`\lvert c_\ell\rvert^2`}</Tex> 隨頻率的分布。對週期訊號它由一根根譜線組成。
          </li>
          <li>
            非週期但「幾乎週期」的序列（例如 <Tex>{r`\alpha`}</Tex> 為無理數時的 <Tex>{r`\rho[n]`}</Tex>）也一樣，只是譜線有無限多根。
          </li>
        </ul>
      </Prereq>
      <p>
        <Tex>{r`C_{ij}`}</Tex> 是兩個訊號相乘的平均：一個是 regressor <Tex>{'x_j'}</Tex> 通過主迴路之後的樣子，另一個是 GMAC 用的 <Tex>{'r_i'}</Tex>。兩個訊號都可以拆成譜線，而不同頻率的弦波相乘的平均是 0，所以只要一條一條頻率分開看：
      </p>
      <Diagram id="spectral" />
      <p>
        先看兩個藍色方塊：同一條頻率 <Tex>{r`f_\nu`}</Tex> 的譜線，在「誤差這一側」被乘上 <Tex>{r`H_{PD}(f_\nu)`}</Tex>，在「regressor 這一側」被乘上 <Tex>{r`G(f_\nu)`}</Tex>（<Tex>{r`c^i_\nu`}</Tex> 是第 <Tex>{'i'}</Tex> 條 regressor 在這條線上的複數係數）。再看相關之後：兩側的係數一個取共軛、一個不取，相乘後留下{' '}
        <Tex>{r`H_{PD}\,\overline G`}</Tex>，這就是推導第 5 步定義的有效 kernel <Tex>{r`\Gamma_{\rm eff}`}</Tex>。圖上最後一格就是第 6 步的對角項：每條線的功率 <Tex>{r`\lvert c^i_\nu\rvert^2`}</Tex> 乘上該頻率的 <Tex>{r`\mathrm{Re}\,\Gamma_{\rm eff}`}</Tex>。
      </p>
      <StepDerivation
        title={mathText(r`一步一步：把 $C$ 寫成譜線的加權和`)}
        steps={[
          { tex: r`x_j[n]=\textstyle\sum_\nu c^j_\nu\,e^{j2\pi f_\nu n}`, why: '把 regressor 展成譜線。' },
          { tex: r`(h_{PD}*x_j)[n]=\textstyle\sum_\nu c^j_\nu\,H_{PD}(f_\nu)\,e^{j2\pi f_\nu n}`, why: <>LTI 系統對每條譜線只乘上 <Tex>{r`H_{PD}`}</Tex>。</> },
          { tex: r`r_i[n]=\textstyle\sum_\nu c^i_\nu\,G(f_\nu)\,e^{j2\pi f_\nu n}`, why: <>GMAC 用的 regressor 是 <Tex>{'x'}</Tex> 經過前置濾波 <Tex>{'G'}</Tex>（raw 時 <Tex>{'G=1'}</Tex>）。</> },
          {
            tex: r`C_{ij}=\langle r_i\,(h_{PD}*x_j)\rangle=\textstyle\sum_\nu \overline{c^i_\nu\,G(f_\nu)}\;c^j_\nu\,H_{PD}(f_\nu)`,
            why: <>Parseval（實數訊號 <Tex>{r`r=\bar r`}</Tex>）：兩個訊號乘積的平均，等於譜線係數兩兩相乘再相加；不同頻率的交叉項平均為 0。</>,
          },
          { tex: r`=\textstyle\sum_\nu \overline{c^i_\nu}\,c^j_\nu\;\Gamma_{\rm eff}(f_\nu),\qquad \Gamma_{\rm eff}\equiv H_{PD}\,\overline{G}`, why: <>把 <Tex>{r`H_{PD}`}</Tex> 與 <Tex>{r`\overline G`}</Tex> 合併成一個 kernel。</> },
          {
            tex: r`C_{ii}=\textstyle\sum_\nu \lvert c^i_\nu\rvert^2\,\mathrm{Re}\,\Gamma_{\rm eff}(f_\nu)`,
            why: <>對角項：實數訊號的譜線成對出現在 <Tex>{r`\pm f`}</Tex>，而 <Tex>{r`\Gamma(-f)=\overline{\Gamma(f)}`}</Tex>，虛部互相抵消，只剩實部。</>,
          },
        ]}
      />
      <Formula id="F-CS.3" />
      <p>
        <strong>白話</strong>：GOS 的「自我斜率」<Tex>{'C_{00}'}</Tex>，是 <Tex>{r`\rho`}</Tex> 的每條譜線功率乘上該頻率的 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 再加總。若功率集中在 <Tex>{r`\mathrm{Re}\,H_{PD}<0`}</Tex>{' '}
        的頻段，總和就是負的。PHOS 的情況相同，只是要對 <Tex>{r`8\times8`}</Tex> 矩陣取特徵值（§8）。
        <Claim kind="exact" />
      </p>
      <Callout kind="info" title="DC 線不影響符號——但不是沒事">
        <p>
          均值那一條線（<Tex>{'f=0'}</Tex>）乘上 <Tex>{r`\Gamma(0)=H_{PD}(1)=0`}</Tex>。Type-I 以上（至少有一個積分器）的迴路都會把 DC 誤差完全吸收，所以 regressor 的平均值（<Tex>{r`\rho`}</Tex> 的 1/2、one-hot 的 1/8）在線性分析中不影響{' '}
          <Tex>{'C'}</Tex>。但它在<strong>比較器有 offset</strong> 時會變成問題（§13），在大訊號時也會影響（§10）。
        </p>
      </Callout>
    </Section>
  )
}
