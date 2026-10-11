import { Callout, ClaimTag, CodeBlock, Derivation, Mermaid, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock } from '@/components'
import fxSrc from '@/simulation/models/filteredX.ts?raw'
import { CHART_FX_LOOP, CHART_GRADIENT, CHART_RHO_READING, CHART_THREE_REGRESSORS } from '../diagrams'
import { FoldSteps } from '../FoldSteps'
import { ErratumNote } from '../ErratumNote'
import { Hand } from '../Hand'

const r = String.raw

/** §7.4：真正的梯度用的是 u = h*x；Filtered-x 的推導；E[q u_f] ≈ K_q(a − w)E[u u_f]；Cauchy–Schwarz 最佳性。 */
export function S4Gradient() {
  return (
    <Section kind="formula" level={2} title="7.4 Filtered-x：從「真正的梯度」推出來的 regressor" id="ch07-gradient">
      <p>
        Delay alignment 是「看相位、湊延遲」的工程技巧。現在換個角度：如果我們老老實實地對 PD 端的誤差做 gradient descent，
        LMS 應該乘上<strong>哪一個</strong>訊號？答案會自然地給出 Filtered-x。
      </p>
      <Prereq title="期望值可以和微分交換；連鎖律（chain rule）">
        <p>
          期望值是「很多次的平均」，平均是線性運算：<Tex>{r`E[f+g]=E[f]+E[g]`}</Tex>、<Tex>{r`E[cf]=cE[f]`}</Tex>。
          只要 <Tex>{'w'}</Tex> 是常數（不是隨機變數），就可以把對 <Tex>{'w'}</Tex> 的微分搬進期望值裡面：
          <Tex>{r`\frac{d}{dw}E[f(w,\cdot)]=E\big[\tfrac{\partial f}{\partial w}\big]`}</Tex>。
          連鎖律：<Tex>{r`\frac{d}{dw}\tfrac12e^2=e\,\frac{de}{dw}`}</Tex>。
        </p>
      </Prereq>

      <TexBlock id="F-07.1" label={<>Ch06 的模型：DTC gain 誤差經過 PLL 誤差路徑 <Tex>{'h'}</Tex> 到達 PD</>}>
        {r`e_{\mathrm{PD}}[n]=(a-w)\,u[n]+v[n],\qquad u[n]=(h*x)[n]`}
      </TexBlock>
      <h3 className="ch07-subhead">步驟 1：PD 端的均方誤差，對 <Tex>{'w'}</Tex> 微分</h3>
      <p>
        先用圖看結論：同一個 PD 誤差 <Tex>{r`e_{\mathrm{PD}}[n]`}</Tex>，拿去乘 <Tex>{'u[n]'}</Tex> 還是乘 <Tex>{'x[n]'}</Tex>，平均出來的東西不一樣。
      </p>
      <Mermaid
        chart={CHART_GRADIENT}
        caption={r`同一個 $e_{\mathrm{PD}}$ 接到兩個乘法器：乘 $u$（真正的梯度 $-dJ/dw$）平均後是 $(a-w)E[u^2]$，方向永遠正確（綠）；乘 $x$（raw-x）平均後是 $(a-w)C$，$C$ 可正可負（紅）。`}
      />
      <p>
        先看圖的前半段：<Tex>{'x[n]'}</Tex> 經過誤差路徑 <Tex>{'h'}</Tex> 變成 <Tex>{'u[n]'}</Tex>，乘上 <Tex>{'(a-w)'}</Tex>、加上雜訊 <Tex>{'v[n]'}</Tex>，就是上面 F-07.1 的
        <Tex>{r`e_{\mathrm{PD}}[n]`}</Tex>。再看兩個乘法器：標著「真正的梯度」的那一個把 <Tex>{r`e_{\mathrm{PD}}`}</Tex> 乘回 <Tex>{'u'}</Tex>——<Tex>{'u'}</Tex> 自己乘自己的平均是
        <Tex>{r`E[u^2]`}</Tex>，不可能是負的；標著「raw-x」的那一個乘的是 <Tex>{'x'}</Tex>，平均出來是 Ch06 的 <Tex>{r`C=E[x\,u]`}</Tex>。下面的推導說明：對 PD 端的誤差功率 <Tex>{'J(w)'}</Tex>（推導第 2 步定義）微分，自然會得到綠色那一路——
        圖上綠色方塊前面的乘法器算的 <Tex>{r`E[e_{\mathrm{PD}}\,u]`}</Tex>，就是 F-07.9 裡梯度 <Tex>{r`dJ/dw`}</Tex> 的負值。
      </p>
      <FoldSteps
        steps={[
          { tex: r`e_{\mathrm{PD}}[n]=(a-w)\,u[n]+v[n],\qquad u=h*x`, why: <>Ch06 的模型：DTC gain 誤差 <Tex>{'(a-w)x'}</Tex> 經過誤差路徑 <Tex>{'h'}</Tex> 到達 PD，再加上雜訊 <Tex>{'v'}</Tex>。</> },
          { tex: r`J(w)=\tfrac12E\big[e_{\mathrm{PD}}^2\big]`, why: <>我們真正想最小化的是 PD 看到的誤差功率（MSE）；<Tex>{r`\tfrac12`}</Tex> 只是讓導數乾淨。</> },
          {
            tex: r`\frac{\partial e_{\mathrm{PD}}}{\partial w}=-u[n]`,
            why: (
              <>
                <Tex>{'v'}</Tex> 與 <Tex>{'w'}</Tex> 無關；<Tex>{'(a-w)u'}</Tex> 對 <Tex>{'w'}</Tex> 微分得 <Tex>{'-u'}</Tex>。
              </>
            ),
          },
          { tex: r`\frac{dJ}{dw}=E\Big[e_{\mathrm{PD}}\frac{\partial e_{\mathrm{PD}}}{\partial w}\Big]=-E\big[e_{\mathrm{PD}}\,u\big]`, why: '先備知識：微分搬進期望值，再用連鎖律。' },
          { tex: r`w\leftarrow w-\mu\frac{dJ}{dw}=w+\mu\,E\big[e_{\mathrm{PD}}\,u\big]`, why: '最陡下降（steepest descent）：往梯度的反方向走。' },
        ]}
        result={r`\frac{dJ}{dw}=-E\big[e_{\mathrm{PD}}\,u\big]\quad\Rightarrow\quad\text{正確的 regressor 是 }u=h*x\text{，不是 }x`}
      />
      <TexBlock id="F-07.9">{r`J(w)=\tfrac12E\big[e_{\mathrm{PD}}^2\big],\qquad \frac{dJ}{dw}=-E\big[e_{\mathrm{PD}}\,u\big]`}</TexBlock>
      <p>
        代回去看它為什麼永遠往對的方向走（<Tex>{'v'}</Tex> 零均值、與 <Tex>{'x'}</Tex> 獨立）：
      </p>
      <TexBlock>{r`\begin{aligned}
E[e_{\mathrm{PD}}\,u]&=(a-w)\,E[u^2]+E[v\,u]&&\text{代入 }e_{\mathrm{PD}}\\
&=(a-w)\,E[u^2]&&E[vu]=E[v]E[u]=0\\
\delta_{k+1}&=\big(1-\mu E[u^2]\big)\,\delta_k,\quad\delta=a-w&&E[u^2]\ge0\text{：方向永遠正確}
\end{aligned}`}</TexBlock>
      <p>
        對照 raw-x GMAC 算的是 <Tex>{r`E[e_{\mathrm{PD}}\,x]=(a-w)\,E[x\,u]=(a-w)\,C`}</Tex>：它是「用錯 regressor 的梯度」。
        <Tex>{r`C=E[xu]`}</Tex> 可以是負的（Ch06），<Tex>{r`E[u^2]`}</Tex> 永遠不會。 <ClaimTag kind="exact" />
      </p>

      <h3 className="ch07-subhead">步驟 2：硬體只有 1-bit comparator，<Tex>{'u'}</Tex> 也看不到 → 用模型 <Tex>{r`\hat H`}</Tex> 產生 <Tex>{'u_f'}</Tex></h3>
      <p>
        兩個實際困難：(1) PD 誤差只經過 1-bit comparator，得到 <Tex>{r`q[n]=\mathrm{sign}(e_{\mathrm{PD}}[n])`}</Tex>；
        (2) <Tex>{'u'}</Tex> 是 PLL 內部的訊號，GMAC 拿不到。解法：用 PLL 誤差路徑的<strong>模型</strong> <Tex>{r`\hat H`}</Tex> 把 code 濾一次，
        <Tex>{r`u_f=\hat h*x`}</Tex>，當作 regressor——這就是 <strong>Filtered-x LMS</strong>（ANC 耳機的 FxLMS 用的是同一個想法：
        喇叭到麥克風的 secondary path 也要先建模）。
      </p>
      <Mermaid
        chart={CHART_THREE_REGRESSORS}
        caption={r`三種 regressor 並排：乘法器與 $q[n]$ 完全相同，只差 $x_{\mathrm{ref}}$ 從哪裡來。藍色是相對 raw-x 多出來的方塊——B 是一條延遲線，C 是誤差路徑的模型 $\hat H$。`}
      />
      <p>
        先看 A（raw-x）：code 直接接到乘法器，誤差路徑的相位 <Tex>{r`\phi`}</Tex> 完全沒有補償。再看 B（delayed-x，7.1–7.3 節）：多一個藍色的
        <Tex>{r`z^{-D}`}</Tex>，補上一條與頻率成正比的相位 <Tex>{r`\Omega D`}</Tex>，只能對準一個頻率。最後看 C（filtered-x）：把藍色方塊換成模型 <Tex>{r`\hat H`}</Tex>，輸出
        <Tex>{r`u_f=\hat h*x`}</Tex> 在<strong>每一個</strong>頻率都帶著模型的振幅與相位。三種做法只差在「GMAC 實際拿來相乘的訊號」，之後統稱
        <Tex>{r`x_{\mathrm{ref}}[n]`}</Tex>：A 是 <Tex>{'x[n]'}</Tex>、B 是 <Tex>{'x[n-D]'}</Tex>、C 是 <Tex>{'u_f[n]'}</Tex>。每個框最後的方塊是那種做法算出來的相關：
        <Tex>{'C'}</Tex>、<Tex>{'C_D'}</Tex>、<Tex>{r`E[u\,u_f]`}</Tex>。（C 後面還可以再串一個 B 的延遲，變成稍後 F-07.10 的 <Tex>{'u_f[n-D]'}</Tex>，用來補
        <Tex>{r`\hat H`}</Tex> 漏算的 latency；圖上畫的是 <Tex>{'D=0'}</Tex>。）
      </p>
      <Prereq title="高斯分布、累積分布函數與誤差函數 erf（Ch05 的 comparator 小訊號增益）">
        <p>
          雜訊 <Tex>{r`v\sim\mathcal N(0,\sigma_v^2)`}</Tex>（Gaussian，鐘形曲線）。<Tex>{r`\Phi(z)=P(Z\le z)`}</Tex> 是標準常態的累積機率，
          <Tex>{r`\mathrm{erf}(z)=\frac{2}{\sqrt\pi}\int_0^ze^{-t^2}dt`}</Tex>，兩者關係 <Tex>{r`2\Phi(z)-1=\mathrm{erf}(z/\sqrt2)`}</Tex>。
          在 0 附近泰勒展開：<Tex>{r`\mathrm{erf}(z)=\frac{2}{\sqrt\pi}\big(z-\tfrac{z^3}{3}+\cdots\big)`}</Tex>，所以小訊號時
          <Tex>{r`\mathrm{erf}(z)\approx\frac{2}{\sqrt\pi}z`}</Tex>（Ch05 有 1 fs vs 100 fs 的完整例子）。
        </p>
      </Prereq>
      <FoldSteps
        title={<>步驟 3：<Tex>{r`E[q\,u_f]`}</Tex> 的小訊號近似</>}
        steps={[
          {
            tex: r`q[n]=\mathrm{sign}\big(s[n]+v[n]\big),\qquad s[n]=(a-w)\,u[n]`,
            why: (
              <>
                comparator 只看誤差的正負號；<Tex>{'s'}</Tex> 是由 code 決定的確定部分（固定 <Tex>{'w'}</Tex>，在一個 block 內近似成立）。
              </>
            ),
          },
          {
            tex: r`E[q\mid s]=P(v>-s)-P(v<-s)=2\Phi\!\Big(\frac{s}{\sigma_v}\Big)-1`,
            why: (
              <>
                <Tex>{'q=+1'}</Tex> 的機率減 <Tex>{'q=-1'}</Tex> 的機率；高斯對稱：<Tex>{r`P(v>-s)=\Phi(s/\sigma_v)`}</Tex>。
              </>
            ),
          },
          { tex: r`=\mathrm{erf}\!\Big(\frac{s}{\sqrt2\,\sigma_v}\Big)\approx\frac{2}{\sqrt\pi}\cdot\frac{s}{\sqrt2\,\sigma_v}=\underbrace{\sqrt{\tfrac{2}{\pi}}\frac1{\sigma_v}}_{K_q}\,s`, why: <>先備知識的關係式與一階泰勒展開（<Tex>{r`|s|\ll\sigma_v`}</Tex>）。</> },
          {
            tex: r`E[q\,u_f]=E\big[E[q\mid s]\,u_f\big]\approx K_q\,(a-w)\,E\big[u\,u_f\big]`,
            why: (
              <>
                先對雜訊平均、再對 code 平均（tower property）：<Tex>{'v'}</Tex> 與 code 獨立，<Tex>{'u_f'}</Tex> 只由 code 決定。
              </>
            ),
          },
          {
            tex: r`\hat H=H\ \Rightarrow\ u_f=u\ \Rightarrow\ E[q\,u_f]\approx K_q\,(a-w)\,E[u^2]`,
            why: <>模型完美時退化成規格 §7 的式子；<Tex>{r`E[u^2]\ge0`}</Tex>。</>,
          },
        ]}
        result={r`E[q\,u_f]\approx K_q\,(a-w)\,E[u\,u_f]\ \overset{\hat H=H}{=}\ K_q\,(a-w)\,E[u^2],\qquad E[u^2]\ge0`}
      />
      <TexBlock id="F-07.11" label="Filtered-x 的平均 GMAC 與 pole">
        {r`E[G_k]\approx K_q\,(a-w_k)\,E[u\,u_f],\qquad p_f=1-\mu K_q\,E[u\,u_f],\qquad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`}
      </TexBlock>
      <p>
        <ClaimTag kind="approx" /> 小誤差 <Tex>{r`|s|\ll\sigma_v`}</Tex>、Gaussian <Tex>{'v'}</Tex>、長時間平均。
        <Tex>{r`\hat H=H`}</Tex> 時 <Tex>{r`E[u^2]\ge0`}</Tex>，所以 <Tex>{r`E[G_k]`}</Tex> 與 <Tex>{r`a-w_k`}</Tex> <strong>同號</strong>：
        <Tex>{'w'}</Tex> 太小就往上修、太大就往下修，<Tex>{r`0<p_f<1`}</Tex>（只要 <Tex>{r`\mu K_qE[u^2]<1`}</Tex>）。
        <Tex>{r`\hat H\ne H`}</Tex> 時一定要用 <Tex>{r`E[u\,u_f]`}</Tex>，不是 <Tex>{r`E[u^2]`}</Tex> 也不是 <Tex>{r`E[u_f^2]`}</Tex>——下一節（7.5）專門處理。{' '}
        <ErratumNote id="E45" />
      </p>

      <h3 className="ch07-subhead">步驟 4：可實作的 block 形式</h3>
      <p>
        規格 §7 寫成 <Tex>{r`w_{k+1}=w_k+\mu E[q[n]u_f[n]]`}</Tex>：那是<strong>平均 ODE</strong>，而且把 sample index <Tex>{'n'}</Tex> 與
        block index <Tex>{'k'}</Tex> 混在一起。硬體實際做的是：{' '}
        <ErratumNote id="E45">
          規格的期望值形式不可直接實作；本站改為 block 形式，並把 <Tex>{r`E[G_k]`}</Tex> 標成近似。
        </ErratumNote>
      </p>
      <Mermaid
        chart={CHART_FX_LOOP}
        caption={r`Filtered-x 的閉迴路：乘法器之前每個 sample（$n$）動一次，平均器之後每個 block（$k$）動一次；累加器的輸出 $w_k$ 以負回授回到真實路徑，形成迴圈。藍色是 code 路徑上的模型 $\hat H$。`}
      />
      <p>
        沿著迴圈走一圈。先看 code 往真實路徑走的那一路：還沒校正掉的 <Tex>{'(a-w_k)'}</Tex> 乘上 <Tex>{'(h*x)[n]'}</Tex>，加上 <Tex>{'v[n]'}</Tex> 得到
        <Tex>{r`e_{\mathrm{PD}}[n]`}</Tex>，comparator 輸出 <Tex>{'q[n]'}</Tex>。再看 code 往藍色模型走的那一路：<Tex>{r`u_f=\hat h*x`}</Tex> 再延遲 <Tex>{'D'}</Tex>。兩路在乘法器相遇，這裡還是
        sample rate（索引 <Tex>{'n'}</Tex>）；平均器每 <Tex>{'N'}</Tex> 個 sample 才吐出一個 <Tex>{'G_k'}</Tex>，之後都是 block rate（索引 <Tex>{'k'}</Tex>）：乘上
        <Tex>{r`\mu`}</Tex> 進累加器，新的 <Tex>{'w_k'}</Tex> 回到真實路徑。圖上的平均器與累加器，分別就是下面 F-07.10 的前兩個式子。只要 <Tex>{r`E[u\,u_f]>0`}</Tex>，
        <Tex>{r`w_k<a`}</Tex> 時 <Tex>{'G_k'}</Tex> 的平均是正的、<Tex>{'w'}</Tex> 被往上推，迴圈是負回授。
      </p>
      <TexBlock id="F-07.10" label={<>Filtered-x 的 block 更新（<Tex>{'n'}</Tex>：comparator sample；<Tex>{'k'}</Tex>：GMAC block）</>}>
        {r`G_k=\frac1N\sum_{n\in\text{block }k}q[n]\,u_f[n-D],\qquad w_{k+1}=w_k+\mu\,G_k,\qquad u_f=\hat h*x`}
      </TexBlock>
      <CodeBlock
        source={fxSrc}
        region="gmac"
        path="src/simulation/models/filteredX.ts"
        title={r`GMAC block（三種 regressor 共用；差別只在 $x_{\mathrm{ref}}$ 怎麼來）`}
        caption={r`$q=\pm1$ 時乘法就是條件取負；本站的閉迴路模擬（runBlockLms）每個 block 做的就是這兩行。`}
      />

      <h3 className="ch07-subhead">怎麼公平地比較不同的 regressor？正規化相關 <Tex>{'\\rho'}</Tex></h3>
      <p>
        比較不同 regressor 不能只看 <Tex>{'C'}</Tex>：把 regressor 放大 10 倍，<Tex>{'C'}</Tex> 也放大 10 倍，但 GMAC 雜訊也放大 10 倍。
        公平的比法是<strong>每單位 regressor 功率</strong>的恢復力——正規化相關（Lab 與後面的比較表都用它）：
      </p>
      <Mermaid
        chart={CHART_RHO_READING}
        caption={r`正規化相關 $\rho$ 怎麼算、怎麼讀：分子除以分母，得到 $-1$ 到 $+1$ 之間的一個數（藍色）；它的符號是更新極性，大小是效率。`}
      />
      <p>
        先看進藍色方塊的兩個量：分子是 regressor 與 <Tex>{'u'}</Tex> 的相關（就是決定 pole 的 <Tex>{'C'}</Tex>），分母是兩個訊號各自的大小（RMS）相乘——把 regressor 放大 10
        倍，分子和分母同時放大 10 倍，<Tex>{r`\rho`}</Tex> 不變。再看藍色方塊出去的兩個讀法：符號告訴你更新方向對不對，大小告訴你雜訊要多平均幾倍。藍色方塊就是下面的 F-07.13。
      </p>
      <TexBlock id="F-07.13" label="正規化相關：1 = 最好（filtered-x）、0 = 沒有恢復力、負值 = 反向更新">
        {r`\rho_{\mathrm{ref}}=\frac{E[x_{\mathrm{ref}}\,u]}{\sqrt{E[x_{\mathrm{ref}}^2]\,E[u^2]}}\in[-1,1]`}
      </TexBlock>
      <p>
        <Tex>{r`\rho`}</Tex> 的符號就是更新極性。單頻時 delayed-x 的 <Tex>{r`\rho=\cos\theta`}</Tex>；<Tex>{r`\hat H=H`}</Tex> 的 filtered-x 恆為 1。<ClaimTag kind="exact" />{' '}
        大小則告訴你「同樣的收斂速度下，雜訊要多平均幾倍」：穩態抖動 <Tex>{r`\sigma_w\propto1/(\sqrt N\,|\rho|)`}</Tex>，所以 <Tex>{r`\rho=0.5`}</Tex> 需要 4 倍的
        <Tex>{'N'}</Tex>（<ClaimTag kind="approx" />；推導在 Engineer 模式）。
      </p>
      <Hand id="HC-07.5">
        用一個單頻的 delayed-x 把 <Tex>{'\\rho'}</Tex> 算一次：預設值是 7.1 節掃描表的 <Tex>{'D=2'}</Tex> 那一列（<Tex>{r`\theta=-60^\circ`}</Tex>，答案
        <Tex>{r`\rho=0.5`}</Tex>、要 4 倍的 <Tex>{'N'}</Tex>）。換成你自己的 <Tex>{'A'}</Tex>、<Tex>{'|H|'}</Tex>、<Tex>{'D'}</Tex> 先用計算機算，順便確認
        <Tex>{'\\rho'}</Tex> 和 <Tex>{'A'}</Tex>、<Tex>{'|H|'}</Tex> 無關。
      </Hand>

      <ModeGate min="engineer">
        <h3 className="ch07-subhead">為什麼 Filtered-x 是「最好」的 regressor？Cauchy–Schwarz</h3>
        <StepDerivation
          title={<>證明 <Tex>{r`|\rho|\le1`}</Tex>，等號成立 <Tex>{r`\iff x_{\mathrm{ref}}\propto u`}</Tex></>}
          steps={[
            { tex: r`0\le E\big[(u-t\,x_{\mathrm{ref}})^2\big]\quad\forall t\in\mathbb R`, why: '平方的平均不會是負的。' },
            { tex: r`=E[u^2]-2t\,E[x_{\mathrm{ref}}u]+t^2E[x_{\mathrm{ref}}^2]`, why: '展開平方，期望值線性。' },
            {
              tex: r`\big(2E[x_{\mathrm{ref}}u]\big)^2-4\,E[x_{\mathrm{ref}}^2]\,E[u^2]\le0`,
              why: (
                <>
                  對 <Tex>{'t'}</Tex> 的二次式 <Tex>{r`\alpha t^2+\beta t+\gamma`}</Tex> 恆 <Tex>{r`\ge0`}</Tex>，若且唯若判別式 <Tex>{r`\beta^2-4\alpha\gamma\le0`}</Tex>（拋物線最多碰到
                  <Tex>{'t'}</Tex> 軸一次）；這裡 <Tex>{r`\alpha=E[x_{\mathrm{ref}}^2]`}</Tex>、<Tex>{r`\beta=-2E[x_{\mathrm{ref}}u]`}</Tex>、<Tex>{r`\gamma=E[u^2]`}</Tex>。
                </>
              ),
            },
            {
              tex: r`E[x_{\mathrm{ref}}u]^2\le E[x_{\mathrm{ref}}^2]\,E[u^2]`,
              why: (
                <>
                  整理即得；等號成立若且唯若存在 <Tex>{'t'}</Tex> 使 <Tex>{r`u=t\,x_{\mathrm{ref}}`}</Tex>，也就是 regressor 與 <Tex>{'u'}</Tex> 成比例（<Tex>{r`\hat H\propto H`}</Tex>）。
                </>
              ),
            },
          ]}
          result={r`|\rho_{\mathrm{ref}}|\le1,\qquad\rho=1\iff x_{\mathrm{ref}}=c\,u,\ c>0`}
        />
        <p>
          單頻時 delayed-x 的 <Tex>{r`\rho=\cos\theta`}</Tex>（對齊時也是 1）；多頻或寬頻時只有 filtered-x 能達到 1（7.3 節的表）。
        </p>
        <Prereq title="變異數（variance）與一階遞迴的穩態變異數">
          <p>
            變異數 <Tex>{r`\mathrm{Var}(X)=E[(X-E[X])^2]`}</Tex> 量測「離平均多遠」；獨立的隨機量相加時變異數相加，乘上常數 <Tex>{'c'}</Tex> 時變異數乘
            <Tex>{'c^2'}</Tex>。對 <Tex>{r`\delta_{k+1}=p\,\delta_k+\varepsilon_k`}</Tex>（<Tex>{r`\varepsilon_k`}</Tex> 彼此獨立、變異數 <Tex>{r`\sigma_\varepsilon^2`}</Tex>、
            <Tex>{r`|p|<1`}</Tex>），穩態時兩邊變異數相等：<Tex>{r`V=p^2V+\sigma_\varepsilon^2\Rightarrow V=\sigma_\varepsilon^2/(1-p^2)`}</Tex>。
          </p>
        </Prereq>
        <Derivation
          title={<>正規化相關 <Tex>{'\\rho'}</Tex> 直接決定同樣收斂速度下的穩態抖動 <Tex>{'\\sigma_w'}</Tex></>}
          level="L1"
          claim="approx"
          derivation={
            <StepDerivation
              steps={[
                {
                  tex: r`\delta_{k+1}=p\,\delta_k-\mu\,\eta_k,\qquad p=1-g,\ g=\mu K_qC`,
                  why: (
                    <>
                      線性化：<Tex>{r`G_k=K_qC\delta_k+\eta_k`}</Tex>，<Tex>{r`\eta_k`}</Tex> 是 GMAC 的平均雜訊（Ch12）。
                    </>
                  ),
                },
                {
                  tex: r`\sigma_\eta^2\approx\frac{E[q^2x_{\mathrm{ref}}^2]}{N}=\frac{E[x_{\mathrm{ref}}^2]}{N}`,
                  why: (
                    <>
                      <Tex>{r`q^2=1`}</Tex>；把 <Tex>{'N'}</Tex> 個 sample 的乘積近似成獨立，平均後變異數除以 <Tex>{'N'}</Tex>。
                    </>
                  ),
                },
                { tex: r`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}\approx\frac{\mu^2\sigma_\eta^2}{2g}`, why: <>AR(1) 遞迴的穩態變異數；<Tex>{r`g\ll1`}</Tex> 時 <Tex>{r`1-p^2\approx2g`}</Tex>。</> },
                { tex: r`=\frac{g\,E[x_{\mathrm{ref}}^2]}{2N\,K_q^2C^2}`, why: <>用 <Tex>{r`\mu=g/(K_qC)`}</Tex> 消去 <Tex>{'\\mu'}</Tex>（固定收斂速度 <Tex>{'g'}</Tex> 做比較）。</> },
                { tex: r`=\frac{g}{2N\,K_q^2\,E[u^2]\,\rho_{\mathrm{ref}}^2}`, why: <>代入 <Tex>{'\\rho'}</Tex> 的定義 <Tex>{r`C^2=\rho^2E[x_{\mathrm{ref}}^2]E[u^2]`}</Tex>。</> },
              ]}
              result={r`\sigma_w\approx\sqrt{\frac{g}{2N}}\;\frac{1}{K_q\sqrt{E[u^2]}\;|\rho_{\mathrm{ref}}|}`}
            />
          }
        />
        <Callout kind="info" title="工程意義">
          <p>
            同樣的收斂速度 <Tex>{'g'}</Tex>（同樣的時間常數），穩態抖動與 <Tex>{r`1/|\rho|`}</Tex> 成正比：<Tex>{r`\rho=0.5`}</Tex> 的 regressor
            要 4 倍的 <Tex>{'N'}</Tex>（4 倍的校正時間）才能達到 filtered-x 的精度。另外 <Tex>{r`\sqrt{E[u^2]}`}</Tex> 也在分母：PLL high-pass
            把低頻 code 衰減掉（<Tex>{r`|H_{\mathrm{PD}}|\ll1`}</Tex>）時，comparator 本來就看不太到 DTC 的 gain 誤差——這是任何 regressor 都救不回來的資訊量限制。
            <ClaimTag kind="approx" />
          </p>
        </Callout>
      </ModeGate>
    </Section>
  )
}
