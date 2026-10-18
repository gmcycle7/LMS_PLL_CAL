import { Fragment, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Callout, ClaimTag, Prereq, Section, SourceTag, SystemMap, Tex, TexBlock, ChRef } from '@/components'
import { loopGainK, msdAfterBlocks, msdSplit } from '@/simulation/models/optimizer'
import { Diagram } from '../Diagram'
import { CH14_SYSTEM_FOCUS, CHART_CAL_LOOP, CHART_COMPARATOR_GAIN } from '../diagrams'
import { Hand, HandLink } from '../Hand'
import { HANDCALCS } from '../handcalcs'
import { BIAS2, md, nf, tx } from '../shared'
import { SymbolsJump } from './S10Symbols'

/** 某個難度的手算題連結（以頓號相連）。 */
function handLinks(level: (typeof HANDCALCS)[number]['level']) {
  return HANDCALCS.filter((h) => h.level === level).map((h, i) => (
    <Fragment key={h.id}>
      {i > 0 && '、'}
      <HandLink id={h.id} />
    </Fragment>
  ))
}

/** §14.0：問題、系統地圖、先備知識、block-rate 迴路圖、先算一次（符號表移到章末：S10Symbols） */
export function S1Intro() {
  const K = loopGainK(100, 0)
  const s2 = 1 / 4096
  const mu = 0.1 / K // 讓 g = 0.1 的 μ
  const p = 1 - mu * K
  const rows = useMemo(() => [0, 1, 2, 3].map((k) => ({ k, ...msdSplit(3, p, mu, s2, k), mean: Math.pow(p, k) * 3 })), [p, mu, s2])
  const noise = mu * mu * s2
  return (
    <>
      <p className="ch14-lead">
        前面幾章告訴我們 LMS <strong>會</strong>收斂、收斂到<strong>哪裡</strong>、以及雜訊會讓係數抖多大。這一章回答最實際的問題：
        <strong>晶片上的 learning rate <Tex>{'\\mu'}</Tex>、每次累加的樣本數 <Tex>{'N'}</Tex>、校正要跑幾次 <Tex>{'B'}</Tex>，到底該怎麼選？</strong>
        答案取決於你在最佳化「什麼」——最快收斂、最小終點 RMS、最小全程誤差、最少 spur、最佳 PVT 追蹤，各自的最佳 <Tex>{'\\mu'}</Tex> 都不同。
      </p>
      <SystemMap
        focus={CH14_SYSTEM_FOCUS}
        caption="系統地圖：藍色的三塊（GMAC、normalize 與 learning rate、gain accumulator）是本章要選數字的地方。教學用概念架構，不是特定晶片的 netlist。"
      />
      <p>
        <strong>你在這裡。</strong>藍色的三塊是本章的主角：GMAC（把 1-bit comparator 的輸出 <Tex>{'q[n]=\\pm1'}</Tex> 乘上 code <Tex>{'x[n]'}</Tex>，每 <Tex>{'N'}</Tex> 個樣本累加一次；comparator 取的是 PD 的輸出 <Tex>{'e[n]'}</Tex>，也就是送進 loop filter 的同一個訊號）、normalize 與 learning rate（<Tex>{'\\div N'}</Tex>、
        <Tex>{'\\times\\mu'}</Tex>）、gain accumulator（存校正係數 <Tex>{'w_k'}</Tex> 的暫存器）。前面各章已經把這三塊的數學講完；本章新增的是<strong>裡面的數字怎麼選</strong>（<Tex>{'N'}</Tex>、<Tex>{'\\mu'}</Tex>、更新幾次
        <Tex>{'B'}</Tex>），以及把選好的步長排程做成一個有保護機制的狀態機。comparator 與它前面的雜訊不是本章的主角，但它們決定了迴路的增益，所以會一直出現。
      </p>
      <SymbolsJump />
      <p>
        <strong>先認識本章反覆出現的幾個量。</strong>
        <Tex>{'a'}</Tex> 是 DTC 真正需要的 gain（未知的正確答案，單位 fs）；<Tex>{'w_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 時 gain register 裡的校正係數；兩者的差 <Tex>{'\\delta_k=a-w_k'}</Tex> 是「還差多少」（本站極性一律{' '}
        <Tex>{'a-w'}</Tex>），<Tex>{'\\delta_0'}</Tex> 是開始校正時的初始誤差。校正迴路每累加 <Tex>{'N'}</Tex> 個 comparator 樣本（稱為一個 GMAC block）得到一個平均輸出 <Tex>{'G_k'}</Tex>，乘上 learning rate <Tex>{'\\mu'}</Tex>{' '}
        後加進暫存器：<Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>（<Tex>{'G_k'}</Tex> 是平均值、沒有單位，所以 <Tex>{'\\mu'}</Tex> 和 <Tex>{'w'}</Tex> 一樣以 fs 計）。總共更新 <Tex>{'B'}</Tex> 次，用掉 <Tex>{'T=NB'}</Tex> 次比較；comparator
        前的雜訊 RMS 記為 <Tex>{'\\sigma_v'}</Tex>。
      </p>
      <p>
        <strong>這些量在晶片上是什麼。</strong>本站全站的接法：reference clock 先經過 DTC 才進 PD，回授路徑上只有 divider。divider 的 feedback edge 比理想時刻早到 <Tex>{'a\\,x[n]'}</Tex>；reference 端的 DTC 只能延遲、不能提前，所以從固定的基準延遲 <Tex>{'T_0'}</Tex> 往回扣：
        <Tex>{'\\tau_\\mathrm{DTC}[n]=T_0-w_k\\,x[n]'}</Tex>，其中 <Tex>{'w_k\\,x[n]'}</Tex> 是這顆 DTC 的<strong>補償量</strong>（reference edge 被提前——也就是少延遲——的時間）。PD 量的是（DTC 延遲後的）reference edge 減 feedback edge：
        <Tex>{String.raw`e[n]=t_\mathrm{ref}^{\prime}[n]-t_\mathrm{fb}[n]=(a-w_k)\,x[n]+v[n]=\delta_k\,x[n]+v[n]`}</Tex>（誤差路徑有相位時，<Tex>{'x[n]'}</Tex> 換成 §14.1 的 <Tex>{'u[n]'}</Tex>）。補償不足（<Tex>{'w_k<a'}</Tex>）時 reference edge 還是太晚，所以誤差和 <Tex>{'x[n]'}</Tex> 同號（<Tex>{'x[n]>0'}</Tex> 的樣本上為正）；<Tex>{'T_0'}</Tex> 是常數，PLL 把它當成靜態相位偏移吸收，不影響任何會動的量。本章的模型把 code 寫成零均值的 <Tex>{'x[n]=\\pm1'}</Tex>：<Tex>{'x[n]<0'}</Tex> 的樣本上「早到 <Tex>{'a\\,x[n]'}</Tex>」是負的，也就是晚到，DTC 的延遲則比 <Tex>{'T_0'}</Tex> 長；code 的平均值只貢獻一個直流（DC）的時間偏移，和 <Tex>{'T_0'}</Tex> 一樣被 PLL 吸收，上面的式子不變。
      </p>
      <p className="small">
        <strong>動手算會比較有感覺。</strong>本章有 {HANDCALCS.length} 題「帶入手算」，各自接在對應的推導或範例正後方：先看推導，馬上把數字換成你自己的，用紙筆和計算機算一次再對答案。只需四則運算：{handLinks('beginner')}；需要工程計算機的{' '}
        <Tex>{'\\ln'}</Tex>、開根號、<Tex>{'y^x'}</Tex>：{handLinks('engineer')}；需要查 <Tex>{'\\Phi'}</Tex> 表：{handLinks('research')}。全站的題目也收在 <Link to="/workbook">手算練習簿</Link>。
      </p>

      <Prereq title="期望值、變異數，以及「均方等於偏差平方加變異數」">
        <p>
          <Tex>{'E[X]'}</Tex>（期望值，expectation）可以想成「同一個實驗重做非常多次，X 的平均」。變異數（variance）衡量 X 在平均值附近散多開：
        </p>
        <TexBlock>{String.raw`\mathrm{Var}(X)=E\big[(X-E[X])^2\big]=E[X^2]-(E[X])^2`}</TexBlock>
        <p>把它移項就得到本章最重要的一條恆等式：</p>
        <TexBlock>{String.raw`\boxed{E[X^2]=\underbrace{(E[X])^2}_{\text{bias}^2}+\underbrace{\mathrm{Var}(X)}_{\text{variance}}}`}</TexBlock>
        <p>
          對 <Tex>{'X=\\delta_B'}</Tex>：均方誤差 = 「平均還差多少」的平方 + 「隨機抖動」。期望值是線性的：<Tex>{'E[aX+bY]=aE[X]+bE[Y]'}</Tex>，常數可以提出來。
        </p>
      </Prereq>

      <Prereq title="獨立（independence）讓交叉項消失">
        <p>
          若 <Tex>{'X'}</Tex>、<Tex>{'Y'}</Tex> 獨立，則 <Tex>{'E[XY]=E[X]E[Y]'}</Tex>。如果其中一個平均為 0，交叉項就是 0。例如兩個不同 block 的 GMAC 雜訊：
        </p>
        <TexBlock>{String.raw`E[\eta_k\eta_j]=E[\eta_k]E[\eta_j]=0\quad(k\ne j),\qquad E[\eta_k^2]=\sigma_\eta^2`}</TexBlock>
        <p>
          這裡 <Tex>{'\\eta_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 的 GMAC 雜訊（<Tex>{'G_k'}</Tex> 減掉它的平均值），<Tex>{'\\sigma_\\eta^2'}</Tex> 是它的變異數。所以「一堆獨立雜訊加權相加」的平方期望值，只剩每一項自己的平方：
          <Tex>{'E[(\\sum_k c_k\\eta_k)^2]=\\sigma_\\eta^2\\sum_k c_k^2'}</Tex>。
        </p>
      </Prereq>

      <Prereq title="等比數列求和（geometric series）">
        <p>
          令 <Tex>{'S=1+r+r^2+\\dots+r^{B-1}'}</Tex>。兩邊乘 <Tex>{'r'}</Tex> 得 <Tex>{'rS=r+r^2+\\dots+r^B'}</Tex>，相減：
        </p>
        <TexBlock>{String.raw`S-rS=1-r^B\ \Rightarrow\ S=\frac{1-r^B}{1-r}\quad(r\ne1),\qquad S=B\quad(r=1)`}</TexBlock>
        <p>
          <Tex>{'|r|<1'}</Tex> 時 <Tex>{'r^B\\to0'}</Tex>，<Tex>{'S\\to1/(1-r)'}</Tex>。本章的 <Tex>{'r=p^2'}</Tex>，其中 <Tex>{'p'}</Tex> 是誤差每過一個 block 剩下的倍數（稱為 pole，§14.0 的方塊圖會定義）。
        </p>
      </Prereq>

      <Prereq title="高斯分布、標準常態 CDF、erf，以及 comparator 增益從哪裡來">
        <p>
          comparator 看到的是 PD 的輸出，這裡先寫成最簡單的 <Tex>{'e=\\delta+v'}</Tex>：<Tex>{'\\delta'}</Tex> 是要偵測的誤差，<Tex>{'v\\sim\\mathcal N(0,\\sigma_v^2)'}</Tex> 是雜訊（高斯分布：鐘形曲線，68% 落在 <Tex>{'\\pm\\sigma_v'}</Tex> 內）。它只輸出正負號{' '}
          <Tex>{'q=\\mathrm{sign}(e)=\\pm1'}</Tex>；<Tex>{'q=+1'}</Tex> 的機率是
          <Tex>{'P(v>-\\delta)=\\Phi(\\delta/\\sigma_v)'}</Tex>，<Tex>{'\\Phi'}</Tex> 是標準常態的累積分布。先看訊號怎麼流，再看數學：
        </p>
        <Diagram chart={CHART_COMPARATOR_GAIN} caption="comparator 的平均輸入輸出關係：誤差與雜訊相加後只留下正負號；重複很多次取平均，誤差小時是一條斜率 $K_q$ 的直線，誤差大時彎曲飽和。">
          <p>
            <strong>先看</strong>最上面：要偵測的誤差 <Tex>{'\\delta'}</Tex> 與雜訊 <Tex>{'v'}</Tex> 在加法點相加（兩條線都是正號），得到 <Tex>{'e=\\delta+v'}</Tex>；comparator 只留下正負號 <Tex>{'q=\\pm1'}</Tex>。<strong>再看</strong>中間：同一個 <Tex>{'\\delta'}</Tex> 重複很多次，每次的 <Tex>{'v'}</Tex> 不同，<Tex>{'q=+1'}</Tex> 的機率是 <Tex>{'\\Phi(\\delta/\\sigma_v)'}</Tex>，平均起來就是 <Tex>{'E[q]'}</Tex>。<strong>最後看</strong>最下面兩個出口：<Tex>{'|\\delta|\\ll\\sigma_v'}</Tex> 時是直線（藍色）；<Tex>{'|\\delta|'}</Tex> 大時 erf 彎曲後頂到 <Tex>{'\\pm1'}</Tex>（紅色，勘誤 E48 的 slew-limited 區）。
          </p>
          <p>
            圖上的 <Tex>{'E[q]=\\mathrm{erf}(\\delta/(\\sqrt2\\sigma_v))'}</Tex> 就是下面公式的第一個等號；藍色方塊的 <Tex>{'K_q'}</Tex> 就是最後一個等號（泰勒一階展開）得到的斜率。
          </p>
        </Diagram>
        <p>把上圖的中間方塊寫成式子，就是：</p>
        <TexBlock>{String.raw`E[q]=2\Phi(\delta/\sigma_v)-1=\mathrm{erf}\!\Big(\frac{\delta}{\sqrt2\sigma_v}\Big)\approx\frac{2}{\sqrt\pi}\cdot\frac{\delta}{\sqrt2\sigma_v}=\sqrt{\frac{2}{\pi}}\frac{\delta}{\sigma_v}=K_q\delta`}</TexBlock>
        <p>
          最後一步是泰勒一階展開（erf 在 0 的斜率為 <Tex>{'2/\\sqrt\\pi'}</Tex>），所以只有 <Tex>{'|\\delta|\\ll\\sigma_v'}</Tex> 時線性。斜率 <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex> 稱為 1-bit comparator 的小訊號增益（單位{' '}
          <Tex>{'\\mathrm{fs^{-1}}'}</Tex>）：雜訊越小，同樣的誤差越容易讓輸出偏向一邊。<Tex>{'|\\delta|'}</Tex> 大時 erf 飽和在 <Tex>{'\\pm1'}</Tex>——這就是勘誤 E48 的 slew-limited 區。
        </p>
      </Prereq>

      <Prereq title="相關（correlation）：$C$ 是什麼">
        <p>
          兩個零均值訊號的相關 <Tex>{'E[x\\,u]'}</Tex> 衡量「<Tex>{'x'}</Tex> 大的時候 <Tex>{'u'}</Tex> 是不是也傾向大」。GMAC 把 comparator 輸出乘上原始 code <Tex>{'x'}</Tex> 再平均，所以它能看到的只有「誤差 <Tex>{'\\delta u'}</Tex> 裡跟 <Tex>{'x'}</Tex> 相關的部分」。若 <Tex>{'x=\\pm1'}</Tex> 經過誤差路徑變成 <Tex>{'u=c\\,x[n]+s\\,x[n-1]'}</Tex>（本章的相位模型，<Tex>{'c=|H|\\cos\\theta,\\ s=|H|\\sin\\theta'}</Tex>；
          <Tex>{'|H|'}</Tex> 是誤差路徑在 code 頻帶的增益、<Tex>{'\\theta'}</Tex> 是它的相位）：
        </p>
        <TexBlock>{String.raw`C=E[x[n]\,u[n]]=c\,E[x[n]^2]+s\,E[x[n]x[n-1]]=c\cdot1+s\cdot0=|H|\cos\theta`}</TexBlock>
        <p>
          <Tex>{'C'}</Tex> 稱為有效相關。延遲一拍的分量 <Tex>{'s'}</Tex> 與 <Tex>{'x[n]'}</Tex> 獨立、平均為 0，所以不提供恢復力；<Tex>{'\\theta>90^\\circ'}</Tex> 時 <Tex>{'C<0'}</Tex>，更新方向反了（<ChRef ch="06">Ch06</ChRef>）。
        </p>
      </Prereq>

      <Prereq title="Pole、Z transform 與一階迴路的 phase margin">
        <p>
          差分方程 <Tex>{'\\delta_{k+1}=p\\delta_k'}</Tex> 的解是 <Tex>{'\\delta_k=p^k\\delta_0'}</Tex>：<Tex>{'|p|<1'}</Tex> 收斂、<Tex>{'p<0'}</Tex> 正負交替。用 Z transform（把序列寫成 <Tex>{'z^{-k}'}</Tex> 的冪級數，延遲一拍 = 乘 <Tex>{'z^{-1}'}</Tex>）看，LMS 是一個積分器 <Tex>{'1/(z-1)'}</Tex> 乘上無因次的迴路增益 <Tex>{'g'}</Tex>（<Tex>{'g=\\mu K'}</Tex>，<Tex>{'p=1-g'}</Tex>；§14.0）。迴路轉移函數 <Tex>{'L(z)'}</Tex> 的大小降到 1 的頻率記為{' '}
          <Tex>{'\\omega_c'}</Tex>，該處的相位離 <Tex>{'-180^\\circ'}</Tex> 還有多遠就是 phase margin（PM）：
        </p>
        <TexBlock>{String.raw`\begin{aligned}
L(z)&=\frac{g}{z-1},\qquad z=e^{j\omega}\ (\omega\ \text{以 rad/block 計})\\
e^{j\omega}-1&=e^{j\omega/2}\big(e^{j\omega/2}-e^{-j\omega/2}\big)=e^{j\omega/2}\cdot2j\sin\tfrac{\omega}{2}\\
L(e^{j\omega})&=\frac{g}{2\sin(\omega/2)}\,e^{-j(\pi/2+\omega/2)}\\
|L(e^{j\omega_c})|=1&\Rightarrow\sin\tfrac{\omega_c}{2}=\tfrac g2\\
PM&=\pi+\angle L(e^{j\omega_c})=\tfrac{\pi}{2}-\tfrac{\omega_c}{2}=90^\circ-\arcsin\tfrac g2
\end{aligned}`}</TexBlock>
        <p className="small muted">
          第 2 行把 <Tex>{'e^{j\\omega/2}'}</Tex> 提出來（Euler：<Tex>{'e^{jx}-e^{-jx}=2j\\sin x'}</Tex>）；第 3 行的 <Tex>{'1/j=e^{-j\\pi/2}'}</Tex> 給出 <Tex>{'-90^\\circ'}</Tex>；最後把弧度換成度。
        </p>
        <p>
          <Tex>{'g=1'}</Tex>（<Tex>{'p=0'}</Tex>）時 <Tex>{'PM=60^\\circ'}</Tex>；<Tex>{'g\\to2'}</Tex> 時 <Tex>{'PM\\to0^\\circ'}</Tex>。細節見 <ChRef ch="08">Ch08</ChRef>。§14.2 (f) 有這個開迴路的方塊圖（把回授線剪開、量出 <Tex>{'L(z)'}</Tex> 的位置）。
        </p>
      </Prereq>

      <Prereq title="PSD（功率頻譜密度）與信賴區間（只用到的部分）">
        <p>
          PSD <Tex>{'S(e^{j\\Omega})'}</Tex> 告訴你訊號功率分布在哪些頻率：<Tex>{'\\sigma^2=\\frac1{2\\pi}\\int_{-\\pi}^{\\pi}S\\,d\\Omega'}</Tex>。白雜訊經過濾波器 <Tex>{'H'}</Tex> 後 PSD 乘上 <Tex>{'|H|^2'}</Tex>。Monte Carlo 的平均值有誤差；95% 信賴區間 <Tex>{'\\approx\\bar X\\pm1.96\\,s/\\sqrt{R}'}</Tex>（<Tex>{'s'}</Tex> 是樣本標準差、<Tex>{'R'}</Tex> 是獨立重複次數；來自中央極限定理：很多獨立樣本的平均近似高斯）。
        </p>
      </Prereq>

      <Section kind="intuition" level={2} title={md(String.raw`14.0 一個問題：$\mu$ 大一點好，還是小一點好？`)} id="ch14-question">
        <p>
          你有一顆 DTC gain 校正：comparator 雜訊 <Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、每個 GMAC block 累加 <Tex>{'N=4096'}</Tex> 次、開機只給
          <Tex>{'T=131072'}</Tex> 次比較（comparator 取樣率 <Tex>{'f_s=4\\,\\mathrm{GHz}'}</Tex> 時約 32.8 µs），也就是 <Tex>{'B=32'}</Tex> 次更新。初始誤差 <Tex>{'\\delta_0=3\\,\\mathrm{fs}'}</Tex>。
        </p>
        <ul>
          <li>
            <strong><Tex>{'\\mu'}</Tex> 太小</strong>：每次只修一點點，32 次後初始誤差還沒收完（<strong>bias</strong> 大）。
          </li>
          <li>
            <strong><Tex>{'\\mu'}</Tex> 太大</strong>：每次更新都把 GMAC 雜訊乘上 <Tex>{'\\mu'}</Tex> 灌進係數（<strong>variance</strong> 大）。
          </li>
        </ul>
        <p>把這個迴路畫成方塊圖，就看得出為什麼同一個旋鈕會同時造成這兩件事（圖上所有訊號都是每個 block 一個值，索引 <Tex>{'k'}</Tex>）：</p>
        <Diagram chart={CHART_CAL_LOOP} caption="校正迴路的 block-rate 模型：藍色的 learning rate 方塊同時決定「修多快」與「放進多少雜訊」。">
          <p>
            <strong>先看</strong>由上到下的主線：正確答案 <Tex>{'a'}</Tex> 減掉暫存器的 <Tex>{'w_k'}</Tex> 得到誤差 <Tex>{'\\delta_k=a-w_k'}</Tex>。GMAC 的平均輸出對誤差的斜率是 <Tex>{'K'}</Tex>（誤差每多 1 fs，<Tex>{'G_k'}</Tex> 平均增加{' '}
            <Tex>{'K'}</Tex>，單位 <Tex>{'\\mathrm{fs^{-1}}'}</Tex>；<Tex>{'K=K_qC'}</Tex> 由 comparator 增益 <Tex>{'K_q'}</Tex> 與有效相關 <Tex>{'C'}</Tex> 決定），再加上這個 block 平均不掉的雜訊 <Tex>{'\\eta_k'}</Tex>，就是{' '}
            <Tex>{'G_k=K\\delta_k+\\eta_k'}</Tex>。<strong>再看</strong>藍色方塊與回授：<Tex>{'G_k'}</Tex> 乘上 <Tex>{'\\mu'}</Tex> 進累加器（<Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>），新的 <Tex>{'w'}</Tex> 回到第一個加法點被減掉（邊上標著負號）。
          </p>
          <p>
            圖上的「<Tex>{'\\times K'}</Tex>」和「<Tex>{'\\times\\mu'}</Tex>」串起來，就是公式裡的無因次迴路增益 <Tex>{'g=\\mu K'}</Tex>：繞一圈，誤差被修掉 <Tex>{'g'}</Tex> 倍、剩下 <Tex>{'p=1-g'}</Tex> 倍（<Tex>{'p'}</Tex> 稱為 pole）。雜訊{' '}
            <Tex>{'\\eta_k'}</Tex> 也要經過「<Tex>{'\\times\\mu'}</Tex>」才進累加器，所以 <Tex>{'\\mu'}</Tex> 加倍時誤差收得快，但每次灌進係數的雜訊功率 <Tex>{'\\mu^2\\sigma_\\eta^2'}</Tex> 變成四倍（<Tex>{'\\sigma_\\eta^2'}</Tex> 是{' '}
            <Tex>{'\\eta_k'}</Tex> 的變異數；<Tex>{'N'}</Tex> 個 <Tex>{'\\pm1'}</Tex> 取平均時約為 <Tex>{'1/N'}</Tex>）。
          </p>
          <p className="small muted">
            本章方塊圖的顏色：藍色是這一段的主角，棕色是和它互相拉扯的另一項，綠色是通過或可用，紅色是失敗或不適用。圖裡的數學和正文一樣用 LaTeX 排版，下面的導讀會把它對回公式。
          </p>
        </Diagram>
        <p>中間一定有個最佳點。我們先用數字感受，再推公式。</p>
      </Section>

      <Section kind="example" level={2} title={md('14.0.1 先算一次：$g=0.1$ 的前三個 block')} id="ch14-hand">
        <p>
          誤差路徑的相位 <Tex>{'\\theta=0'}</Tex>、增益 <Tex>{'|H|=1'}</Tex>（也就是 code 與誤差完全對齊）時，有效相關 <Tex>{'C=|H|\\cos\\theta=1'}</Tex>，斜率就等於 comparator 的小訊號增益 <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>。取 <Tex>{`K=K_q=\\sqrt{2/\\pi}/100=${tx(K, 6)}\\,\\mathrm{fs^{-1}}`}</Tex>，選 <Tex>{`\\mu=0.1/K=${tx(mu, 5)}\\,\\mathrm{fs}`}</Tex>，所以
          <Tex>{`g=0.1,\\ p=0.9`}</Tex>；<Tex>{`\\sigma_\\eta^2=1/4096`}</Tex>，每次更新注入的雜訊功率
          <Tex>{`\\mu^2\\sigma_\\eta^2=${tx(noise, 5)}\\,\\mathrm{fs^2}`}</Tex>。均方誤差每個 block 的規則只有一行（下一節會推導）：
        </p>
        <TexBlock>{String.raw`E[\delta_{k+1}^2]=p^2\,E[\delta_k^2]+\mu^2\sigma_\eta^2`}</TexBlock>
        <TexBlock>{String.raw`\begin{aligned}
E[\delta_1^2]&=0.81\times ${tx(rows[0].total, 5)}+${tx(noise, 4)}=${tx(rows[1].total, 6)}\\
E[\delta_2^2]&=0.81\times ${tx(rows[1].total, 6)}+${tx(noise, 4)}=${tx(rows[2].total, 6)}\\
E[\delta_3^2]&=0.81\times ${tx(rows[2].total, 6)}+${tx(noise, 4)}=${tx(rows[3].total, 6)}
\end{aligned}`}</TexBlock>
        <div className="table-wrap">
          <table className="ch14-table">
            <thead>
              <tr>
                <th>
                  <Tex>{'k'}</Tex>
                </th>
                <th>
                  <Tex>{'E[\\delta_k]=p^k\\delta_0'}</Tex>
                </th>
                <th>
                  <Tex>{'\\text{bias}^2=p^{2k}\\delta_0^2'}</Tex>
                </th>
                <th>
                  <Tex>{'\\text{variance}=\\mu^2\\sigma_\\eta^2\\frac{1-p^{2k}}{1-p^2}'}</Tex>
                </th>
                <th>
                  <Tex>{'E[\\delta_k^2]\\ (\\mathrm{fs^2})'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td className="num">{r.k}</td>
                  <td className="num">{nf(r.mean, 5)}</td>
                  <td className="num">{nf(r.bias2, 5)}</td>
                  <td className="num">{nf(r.variance, 5)}</td>
                  <td className="num">{nf(r.total, 6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          觀察：{BIAS2} 每步乘 0.81（縮小 19%），variance 從 0 開始慢慢長，最後停在 <Tex>{`\\mu^2\\sigma_\\eta^2/(1-p^2)=${tx(msdAfterBlocks(0, p, mu, s2, 1e6), 4)}\\,\\mathrm{fs^2}`}</Tex>。表格最後一欄與下一節的封閉式完全相同 <ClaimTag kind="exact" /> <SourceTag kind="illustrative" />。
        </p>
        <Callout kind="info" title="你會發現">
          前幾個 block 幾乎全是 {BIAS2}；如果只跑 3 個 block，<Tex>{'\\mu'}</Tex> 應該再大一點。但 <Tex>{'B=32'}</Tex> 時 {BIAS2} 會被壓到很小，variance 反而成為主角——<strong>最佳 <Tex>{'\\mu'}</Tex> 取決於 <Tex>{'B'}</Tex></strong>。
        </Callout>
        <Hand id="HC-14.1">
          上面的表格是 <Tex>{'g=0.1'}</Tex> 的情形。把 <Tex>{'g'}</Tex> 改成 0.25 或 0.5（或換成你自己的 <Tex>{'K'}</Tex>、<Tex>{'N'}</Tex>），先用紙筆照同一條遞迴算三列，再對答案——注意 <Tex>{'g'}</Tex> 越大，{BIAS2} 掉得越快，但每次注入的雜訊也越大。
        </Hand>
      </Section>
    </>
  )
}
