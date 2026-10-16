import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, ModeGate, Prereq, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import { normSf } from '@/simulation/core'
import acceptanceSrc from '@/simulation/models/acceptance.ts?raw'
import { pPlus } from '@/simulation/models/comparator'
import { calLoop } from '@/simulation/models/calNoise'
import {
  ACCEPTANCE_INPUTS,
  ar1Lag1Expectation,
  ar1SampleVarianceFactor,
  bernoulliVarianceSe,
  equivalentZ,
  falseAlarmRate,
  falseAlarmRateT,
  MC_PLAN,
  tCritical,
} from '@/simulation/models/acceptance'
import { Expand, FBlock, M, steps } from '../common'
import { fmtNum, texNum } from '../format'

const r = String.raw

/** §V.3 的數學：先備知識、先算一次（T04）、z 檢定、五種「SE 與偏差」的推導。所有數字都即時計算。 */
export function McTheory() {
  const nums = useMemo(() => {
    const i4 = ACCEPTANCE_INPUTS.T04
    const p = pPlus(i4.s_fs, i4.sigma_fs)
    const sig = Math.sqrt(p * (1 - p))
    const hand = [1e4, 1e5, 1e6, 1e7].map((n) => ({ n, se: sig / Math.sqrt(n), ratio: (p - 0.5) / (sig / Math.sqrt(n)) }))
    const n4 = ((4 * sig) / (p - 0.5)) ** 2
    const i13 = ACCEPTANCE_INPUTS.T13
    const lp = calLoop({ N: i13.N, fs: i13.fs_hz, mu: i13.mu_fs, sigmaV: i13.sigma_v_fs, C: i13.C })
    const nBlk = 4000
    const R = 24
    const fVar = ar1SampleVarianceFactor(lp.p, nBlk)
    const relSdChain = Math.sqrt((2 * (1 + lp.p * lp.p)) / ((1 - lp.p * lp.p) * nBlk)) // Bartlett：SD(s²)/σ²
    const relSe = relSdChain / Math.sqrt(R)
    const pExp1 = ar1Lag1Expectation(lp.p, nBlk, 1)
    const pExpR = ar1Lag1Expectation(lp.p, nBlk, R)
    const seP = Math.sqrt((1 - lp.p * lp.p) / (nBlk * R))
    const rho = [1, 10, 50].map((k) => ({ k, v: Math.pow(lp.p, k) })) // AR(1) 的自相關 p^k
    return { p, sig, hand, n4, lp, nBlk, R, fVar, relSe, pExp1, pExpR, seP, rho, tau: (1 + lp.p) / (1 - lp.p) }
  }, [])
  // 「模型正確卻偶然失敗」只和應該通過的項目有關：反面項目（expect = 'reject'）與非獨立的項目不計
  const nIndep = MC_PLAN.filter((c) => c.kind === 'z' && c.independent && c.expect === 'agree').length
  const a4 = falseAlarmRate(4)

  return (
    <>
      <Prereq title="期望值、變異數與標準差：把「很多次的平均」寫成符號">
        <p>
          丟一枚不公平的硬幣，出現正面記 <Tex>{'X=1'}</Tex>、反面記 <Tex>{'X=0'}</Tex>，正面機率 <Tex>{'p'}</Tex>。
        </p>
        <ul>
          <li>
            <strong>期望值（expectation）</strong> <Tex>{r`E[X]`}</Tex>：重複無限多次後的平均。這裡 <Tex>{r`E[X]=1\cdot p+0\cdot(1-p)=p`}</Tex>。它是<strong>線性</strong>的：
            <Tex>{r`E[aX+bY]=aE[X]+bE[Y]`}</Tex>。
          </li>
          <li>
            <strong>變異數（variance）</strong> <Tex>{r`\operatorname{Var}(X)=E[(X-E[X])^2]`}</Tex>：離平均有多遠（平方後再平均）。這裡{' '}
            <Tex>{r`\operatorname{Var}(X)=(1-p)^2p+(0-p)^2(1-p)=p(1-p)`}</Tex>。
          </li>
          <li>
            <strong>標準差（standard deviation）</strong> <Tex>{r`\sigma=\sqrt{\operatorname{Var}(X)}`}</Tex>：和 <Tex>{'X'}</Tex> 同單位的「典型偏離量」。
          </li>
          <li>
            兩個<strong>獨立</strong>的量：<Tex>{r`\operatorname{Var}(X+Y)=\operatorname{Var}(X)+\operatorname{Var}(Y)`}</Tex>；乘上常數：<Tex>{r`\operatorname{Var}(aX)=a^2\operatorname{Var}(X)`}</Tex>。
            下面的 <Tex>{r`\mathrm{SE}=\sigma/\sqrt n`}</Tex> 只用到這兩條。
          </li>
        </ul>
        <p className="small">對 comparator：<Tex>{'X_i'}</Tex> 就是「第 <Tex>{'i'}</Tex> 個決策是否為 <Tex>{'+1'}</Tex>」，<Tex>{'p=P(q=+1)'}</Tex>（<ChRef ch="05">Ch05</ChRef>）。</p>
      </Prereq>
      <Prereq title="常態分布、$\Phi$ 與「幾個 $\sigma$」">
        <p>
          <strong>標準常態分布</strong> <Tex>{r`\mathcal N(0,1)`}</Tex> 是平均 0、標準差 1 的鐘形分布，機率密度 <Tex>{r`\varphi(z)=\tfrac{1}{\sqrt{2\pi}}e^{-z^2/2}`}</Tex>。
          <Tex>{r`\Phi(z)=\int_{-\infty}^{z}\varphi(t)\,dt`}</Tex> 是「落在 <Tex>{'z'}</Tex> 以下」的機率（累積分布函數，CDF）；它沒有初等函數的封閉式，程式用 <code>erfc</code> 計算。
          「超過 <Tex>{r`\pm z`}</Tex> 個標準差」的機率是 <Tex>{r`2[1-\Phi(z)]`}</Tex>：
        </p>
        <div className="table-wrap">
          <table className="ver-table ver-handcalc">
            <thead>
              <tr>
                <th>
                  <Tex>{'z'}</Tex>
                </th>
                {[1, 2, 3, 4, 5].map((z) => (
                  <th key={z}>{z}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{r`2[1-\Phi(z)]`}</Tex>
                </td>
                {[1, 2, 3, 4, 5].map((z) => (
                  <td key={z} className="num">
                    <Tex>{texNum(2 * normSf(z), 3)}</Tex>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          （以 core 的 <code>normSf</code> 即時計算。）所以「超過 4 個 <Tex>{r`\sigma`}</Tex>」的事件大約每 {Math.round(1 / (2 * normSf(4))).toLocaleString('en-US')} 次才偶然出現一次。
        </p>
      </Prereq>
      <Prereq title="中央極限定理（CLT）：為什麼平均值的誤差長得像常態分布">
        <p>
          把 <Tex>{'n'}</Tex> 個獨立、同分布、變異數有限的量加起來（或取平均），不管單一個量長什麼樣子（就算只取 0 和 1），<Tex>{'n'}</Tex> 夠大時「平均值減掉期望值、再除以它的標準差」會趨近{' '}
          <Tex>{r`\mathcal N(0,1)`}</Tex>：
        </p>
        <TexBlock>{r`\frac{\bar X-E[X]}{\sigma/\sqrt n}\ \xrightarrow{\ n\to\infty\ }\ \mathcal N(0,1)`}</TexBlock>
        <p className="small">
          兩個前提很重要：<strong>獨立</strong>（相關樣本要另外處理，見下方第 3 點）與<strong>變異數有限</strong>（heavy tail 會讓它失效，見 §V.5 的 T03）。
        </p>
      </Prereq>
      <Prereq title="共變異數、相關係數與 AR(1)：樣本「不獨立」時怎麼描述">
        <ul>
          <li>
            <strong>共變異數（covariance）</strong> <Tex>{r`\operatorname{Cov}(X,Y)=E\big[(X-E[X])(Y-E[Y])\big]`}</Tex>：兩個量「一起偏高、一起偏低」的程度。獨立時為 0；
            <Tex>{r`\operatorname{Cov}(X,X)=\operatorname{Var}(X)`}</Tex>。
          </li>
          <li>
            <strong>相關係數（correlation coefficient）</strong> <Tex>{r`\rho=\operatorname{Cov}(X,Y)/(\sigma_X\sigma_Y)\in[-1,1]`}</Tex>：把共變異數除以兩個標準差，變成無因次。
          </li>
          <li>
            不獨立時變異數<strong>不能直接相加</strong>：<Tex>{r`\operatorname{Var}(X+Y)=\operatorname{Var}(X)+\operatorname{Var}(Y)+2\operatorname{Cov}(X,Y)`}</Tex>（把{' '}
            <Tex>{r`(X+Y)^2`}</Tex> 展開就得到交叉項）。
          </li>
          <li>
            <strong>自相關（autocorrelation）</strong>：同一條序列裡相隔 <Tex>{'k'}</Tex> 個樣本的相關係數 <Tex>{r`\rho_k=\operatorname{Cov}(x_i,x_{i+k})/\sigma^2`}</Tex>。
          </li>
        </ul>
        <p>
          <strong>AR(1)（一階自迴歸，first-order autoregressive）</strong>是最簡單的相關序列：下一個值 = 上一個值乘 <Tex>{'p'}</Tex>，再加一個獨立的新擾動。校正迴路的係數雜訊{' '}
          <Tex>{r`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k`}</Tex> 正是這種形式（<ChRef ch="12">Ch12</ChRef>；T13 的 <Tex>{`p=${fmtNum(nums.lp.p, 5)}`}</Tex>）：
        </p>
        <StepDerivation
          steps={steps([
            { tex: r`x_{i+1}=p\,x_i+\xi_i,\qquad E[\xi_i]=0,\ \ \xi_i\ \text{與}\ x_i,x_{i-1},\ldots\ \text{獨立}`, why: r`定義：$\xi_i$ 是每一步新加入的白色擾動（T13 中 $\xi_i=\mu\eta_i$），$|p|<1$。` },
            {
              tex: r`\sigma^2=\operatorname{Var}(x_{i+1})=p^2\operatorname{Var}(x_i)+\operatorname{Var}(\xi_i)=p^2\sigma^2+\sigma_\xi^2\ \Rightarrow\ \sigma^2=\frac{\sigma_\xi^2}{1-p^2}`,
              why: r`穩態時每一步的變異數相同；$x_i$ 與 $\xi_i$ 獨立，所以變異數可以相加。代入 $\sigma_\xi=\mu\sigma_\eta$ 就是 T13 的 $\sigma_w^2=\mu^2\sigma_\eta^2/(1-p^2)$。`,
            },
            { tex: r`\operatorname{Cov}(x_{i+1},x_i)=E[(p\,x_i+\xi_i)\,x_i]=p\,E[x_i^2]+E[\xi_i]\,E[x_i]=p\,\sigma^2`, why: r`代入定義（平均為 0，所以共變異數就是乘積的期望值）；$\xi_i$ 與 $x_i$ 獨立且零均值，交叉項是 0。` },
            { tex: r`\operatorname{Cov}(x_{i+k},x_i)=p\operatorname{Cov}(x_{i+k-1},x_i)=\cdots=p^{k}\sigma^2\ \Rightarrow\ \rho_k=p^{k}`, why: r`同一個步驟重複 $k$ 次：每往後一步，相關係數再乘一次 $p$（等比數列）。` },
          ])}
          result={`p=${fmtNum(nums.lp.p, 5)}:\\quad\\rho_{1}=${fmtNum(nums.rho[0].v, 4)},\\ \\ \\rho_{10}=${fmtNum(nums.rho[1].v, 3)},\\ \\ \\rho_{50}=${fmtNum(nums.rho[2].v, 3)}`}
        />
        <p className="small">
          所以相鄰的 <Tex>{r`\delta w_k`}</Tex> 幾乎一樣，要隔幾十個 block 才算「新的」樣本：<Tex>{'n'}</Tex> 個相關樣本帶的資訊比 <Tex>{'n'}</Tex> 個獨立樣本少。對「平均值」而言，等效的獨立樣本數約{' '}
          <Tex>{`n\\,\\tfrac{1-p}{1+p}=n/${fmtNum(nums.tau, 3)}`}</Tex>（<Tex>{r`\sum_{k=-\infty}^{\infty}p^{|k|}=\tfrac{1+p}{1-p}`}</Tex> 稱為積分相關時間，單位是 block）。
        </p>
      </Prereq>
      <Prereq title="卡方分布 $\chi^2_\nu$ 與 Student-$t$：「樣本標準差」自己也是隨機的">
        <p>
          取 <Tex>{r`\nu`}</Tex> 個獨立的標準常態 <Tex>{r`Z_1,\ldots,Z_\nu`}</Tex>，把它們的平方加起來：<Tex>{r`\chi^2_\nu=Z_1^2+\cdots+Z_\nu^2`}</Tex>。這個和的分布叫<strong>卡方分布</strong>（
          <Tex>{r`\nu`}</Tex> 稱為自由度），期望值 <Tex>{r`\nu`}</Tex>、變異數 <Tex>{r`2\nu`}</Tex>。它的用途：<Tex>{'m'}</Tex> 個獨立常態樣本的樣本變異數 <Tex>{'s^2'}</Tex> 滿足{' '}
          <Tex>{r`(m-1)\,s^2/\sigma^2\sim\chi^2_{m-1}`}</Tex>，所以 <Tex>{'s^2'}</Tex> 的相對標準差是 <Tex>{r`\sqrt{2/(m-1)}`}</Tex>、<Tex>{'s'}</Tex> 的相對誤差大約是{' '}
          <Tex>{r`1/\sqrt{2(m-1)}`}</Tex>（<Tex>{`m=${nums.R}`}</Tex> 條 chain 時約 <Tex>{`${fmtNum(100 / Math.sqrt(2 * (nums.R - 1)), 3)}\\%`}</Tex>）。
        </p>
        <p>
          如果把「真的 <Tex>{r`\sigma`}</Tex>」換成「估計的 <Tex>{'s'}</Tex>」去標準化一個平均值，得到的比值 <Tex>{r`t=(\bar X-\theta)/(s/\sqrt m)`}</Tex> 就不再是常態，而是{' '}
          <strong>
            Student-<Tex>{'t'}</Tex>
          </strong>
          （自由度 <Tex>{r`\nu=m-1`}</Tex>）：分母偶爾偏小，讓比值偶爾特別大——尾巴比常態厚。<Tex>{r`\nu\to\infty`}</Tex> 時它回到常態。本頁用到它的累積分布函數{' '}
          <Tex>{r`F_\nu(t)=P(t_\nu\le t)`}</Tex>（core 的 <code>studentTCdf</code>）。
        </p>
      </Prereq>

      <h3>先算一次：要丟幾次，才看得出 50.4% 不是 50%？</h3>
      <p>
        T04 說 <Tex>{r`s=1\,\mathrm{fs}`}</Tex>、<Tex>{r`\sigma_v=100\,\mathrm{fs}`}</Tex> 時 <Tex>{`p=P(q=+1)=${fmtNum(nums.p, 7)}`}</Tex>。假設你真的拿 comparator 量 <Tex>{'n'}</Tex> 次，數出{' '}
        <Tex>{r`\hat p`}</Tex>。單次的標準差是 <Tex>{`\\sigma=\\sqrt{p(1-p)}=${fmtNum(nums.sig, 6)}`}</Tex>，所以 <Tex>{r`\hat p`}</Tex> 的標準誤是{' '}
        <Tex>{r`\sigma/\sqrt n`}</Tex>：
      </p>
      <div className="table-wrap">
        <table className="ver-table ver-handcalc">
          <thead>
            <tr>
              <th>
                決策數 <Tex>{'n'}</Tex>
              </th>
              <th>
                <Tex>{r`\mathrm{SE}=\sqrt{p(1-p)/n}`}</Tex>
              </th>
              <th>
                訊號 <Tex>{r`p-\tfrac12`}</Tex>
              </th>
              <th>
                <Tex>{r`(p-\tfrac12)/\mathrm{SE}`}</Tex>
              </th>
              <th>看得出來嗎？</th>
            </tr>
          </thead>
          <tbody>
            {nums.hand.map((h) => (
              <tr key={h.n}>
                <td>
                  <Tex>{texNum(h.n, 2)}</Tex>
                </td>
                <td className="num">{fmtNum(h.se, 3)}</td>
                <td className="num">{fmtNum(nums.p - 0.5, 4)}</td>
                <td className="num">{fmtNum(h.ratio, 3)}</td>
                <td>{h.ratio >= 4 ? '可以（> 4 個 SE）' : h.ratio >= 2 ? '勉強（2–4 個 SE）' : '看不出（埋在雜訊裡）'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        要讓 <Tex>{r`p-\tfrac12`}</Tex> 至少是 4 個 SE，需要 <Tex>{`n\\ge\\big(4\\sigma/(p-\\tfrac12)\\big)^2\\approx${texNum(nums.n4, 3)}`}</Tex> 個決策。這就是 Monte Carlo 驗證的全部精神：
        <strong>估計值不會剛好等於期望值，但它偏離多少，可以用 SE 當尺來量。</strong>
      </p>

      <Expand title="$z$ 檢定與誤報率：為什麼門檻取 4 個標準誤" badge="推導">
        <StepDerivation
          steps={steps([
            { tex: r`\hat\theta=\frac1n\sum_{i=1}^nX_i,\qquad E[X_i]=\theta,\ \ \operatorname{Var}(X_i)=\sigma^2`, why: r`MC 估計就是 $n$ 個獨立樣本的平均（例如 $X_i$ = 第 $i$ 個 comparator 決策是否為 $+1$）。` },
            { tex: r`E[\hat\theta]=\frac1n\sum_iE[X_i]=\theta`, why: r`期望值是線性的：平均值的期望值就是 $\theta$（估計量無偏）。` },
            { tex: r`\operatorname{Var}(\hat\theta)=\frac{1}{n^2}\sum_i\operatorname{Var}(X_i)=\frac{\sigma^2}{n}`, why: r`常數 $1/n$ 提出來要平方；獨立變數的變異數直接相加，共 $n$ 項。` },
            { tex: r`\mathrm{SE}=\sqrt{\operatorname{Var}(\hat\theta)}=\frac{\sigma}{\sqrt n}`, why: r`標準誤：樣本數加 4 倍，誤差只減半。` },
            { tex: r`z=\frac{\hat\theta-\theta}{\mathrm{SE}}\ \xrightarrow{\ n\to\infty\ }\ \mathcal N(0,1)`, why: r`中央極限定理：模型正確時 $z$ 近似標準常態。` },
            { tex: r`\alpha=P(|z|>z_{\rm crit})=2\,[1-\Phi(z_{\rm crit})]`, why: r`模型其實正確、卻因運氣不好被判失敗的機率（誤報率）；兩側尾巴各 $1-\Phi(z_{\rm crit})$。` },
            { tex: `z_{\\rm crit}=4:\\ \\alpha=${texNum(a4, 4)};\\qquad z_{\\rm crit}=2:\\ \\alpha=${texNum(falseAlarmRate(2), 4)}`, why: r`以 core 的 normSf 即時計算（尾端保有相對精度）。` },
            { tex: r`P(\text{K 項中至少一項誤報})=1-(1-\alpha)^K\le K\alpha`, why: r`每項不誤報的機率是 $1-\alpha$，$K$ 項獨立則相乘；$K\alpha$ 是不需要獨立假設的聯集上界（Bonferroni）。` },
          ])}
          result={r`\text{通過}\iff|z|\le z_{\rm crit}\qquad(\text{反面項目則要求 }|z|>z_{\rm crit})`}
        />
        <FBlock id="F-VF.3" />
        <FBlock id="F-VF.4" />
        <p className="small">
          本頁有 {nIndep} 項應該通過、互相獨立的 <Tex>{'z'}</Tex> 檢查（反面項目與「非獨立」的 T17 變異不計；T13 與 T14 共用同一批樣本，嚴格說不完全獨立，但聯集上界{' '}
          <Tex>{r`K\alpha`}</Tex> 不需要獨立）：<Tex>{`${nIndep}\\times${texNum(a4, 3)}\\approx${texNum(nIndep * a4, 2)}`}</Tex>，所以「模型全對、卻偶然有一項失敗」的機率不到千分之一。
          反過來，門檻越寬，<strong>檢定力</strong>（模型真的錯時能抓到的機率）越低：
        </p>
        <FBlock id="F-VF.11" />
        <p className="small">
          樣本數變 4 倍（scale 調到 4），SE 減半，能抓到一半大小的錯誤。 <ClaimTag kind="approx" />
        </p>
      </Expand>

      <ModeGate min="engineer">
        <Expand title="五個細節：SE 怎麼算、估計量本身有沒有偏差" badge="推導" openFrom="research">
          <p>
            <strong>(1) 比例（T04、T05）。</strong> <Tex>{r`X_i\in\{0,1\}`}</Tex> 的 Bernoulli：<Tex>{r`\operatorname{Var}(X_i)=p(1-p)`}</Tex>，所以
          </p>
          <TexBlock>{r`\mathrm{SE}(\hat p)=\sqrt{\frac{p(1-p)}{n}}`}</TexBlock>
          <p className="small">
            注意：檢定「<Tex>{r`\hat p`}</Tex> 是否等於期望的 <Tex>{'p'}</Tex>」時，SE 要用<strong>期望值的</strong> <Tex>{'p'}</Tex>（虛無假設成立時的真 SE），不是 <Tex>{r`\hat p`}</Tex>。
          </p>

          <p>
            <strong>(2) 兩點分布的樣本變異數（T17）——它不是獨立的證據。</strong> stochastic rounding 的輸出只有 32 和 33 兩個值，令 <Tex>{r`\hat p`}</Tex> 為 33 的比例：
          </p>
          <StepDerivation
            steps={steps([
              { tex: r`\bar y=32+\hat p`, why: r`樣本平均：$n\hat p$ 個 33、其餘是 32。` },
              { tex: r`\sum_i(y_i-\bar y)^2=n\hat p\,(1-\hat p)^2+n(1-\hat p)\,\hat p^2=n\hat p(1-\hat p)`, why: r`33 的偏差是 $1-\hat p$、32 的偏差是 $-\hat p$；提出 $n\hat p(1-\hat p)$ 後括號內是 $(1-\hat p)+\hat p=1$。` },
              { tex: r`s^2=\frac{n}{n-1}\,\hat p\,(1-\hat p)`, why: r`除以 $n-1$。重點：$s^2$ 完全由 $\hat p$ 決定——它和平均值不是兩個獨立的量測。` },
              { tex: r`\mathrm{SE}(s^2)\approx\Big|\frac{d}{dp}\,p(1-p)\Big|\,\mathrm{SE}(\hat p)=|1-2p|\sqrt{\frac{p(1-p)}{n}}`, why: r`一階泰勒（delta method）：函數的誤差約等於「斜率乘上自變數的誤差」。` },
              { tex: r`\mu_4-\sigma^4=p(1-p)[1-3p(1-p)]-p^2(1-p)^2=p(1-p)(1-2p)^2`, why: r`用四階中央動差的一般式 $\operatorname{Var}(s^2)\approx(\mu_4-\sigma^4)/n$ 得到同一個結果（$1-4p(1-p)=(1-2p)^2$）。` },
            ])}
            result={`p=0.4,\\ n=10^6:\\ \\ \\mathrm{SE}(s^2)=${texNum(bernoulliVarianceSe(0.4, 1e6), 3)}\\ \\mathrm{LSB^2}`}
          />
          <FBlock id="F-VF.9" />
          <Callout kind="warn" title="所以 T17 的「變異」那一列，$z$ 幾乎等於「平均」那一列">
            兩列共用同一個 <Tex>{r`\hat p`}</Tex>，通過一列就等於通過另一列。真正獨立的資訊是「<strong>每次抽樣彼此獨立</strong>」（才叫 randomized，頻譜才是白的）——所以本頁多加一列
            lag-1 自相關 <Tex>{'r_1'}</Tex>：iid 序列的 <Tex>{r`r_1\approx0\pm1/\sqrt n`}</Tex>，而週期 toggle <Tex>{'[32,32,33,32,33]'}</Tex> 的 <Tex>{r`r_1=-\tfrac23`}</Tex> 會立刻被抓到。
          </Callout>

          <p>
            <strong>(3) 相關樣本（T13）——樣本變異數會偏低。</strong> 同一條 chain 的 <Tex>{r`\delta w_k`}</Tex> 是 AR(1)：相隔 <Tex>{'k'}</Tex> 個 block 的相關係數是{' '}
            <Tex>{`p^k`}</Tex>，<Tex>{`p=${fmtNum(nums.lp.p, 5)}`}</Tex>。每條 chain 取 <Tex>{'n'}</Tex> 個連續樣本、扣掉<strong>自己的樣本平均</strong> <Tex>{r`\bar x`}</Tex> 再算{' '}
            <Tex>{'s^2'}</Tex>：
          </p>
          <StepDerivation
            steps={steps([
              { tex: r`(n-1)\,s^2=\sum_{i=1}^n(x_i-\bar x)^2=\sum_ix_i^2-n\bar x^2`, why: r`展開平方，用 $\sum_ix_i=n\bar x$ 合併交叉項。` },
              { tex: r`E\Big[\sum_ix_i^2\Big]=n\sigma^2`, why: r`每個 $x_i$ 的變異數都是 $\sigma^2$（平穩、平均為 0）。` },
              { tex: r`E[\bar x^2]=\operatorname{Var}(\bar x)=\frac{1}{n^2}\sum_{i=1}^n\sum_{j=1}^n\operatorname{Cov}(x_i,x_j)=\frac{\sigma^2}{n^2}\sum_{i,j}p^{|i-j|}`, why: r`樣本不獨立，所以交叉項不為 0：$\operatorname{Cov}(x_i,x_j)=\sigma^2p^{|i-j|}$。` },
              { tex: r`\sum_{i,j}p^{|i-j|}=n+2\sum_{k=1}^{n-1}(n-k)\,p^k=n+2S_1`, why: r`對角線 $n$ 項是 1；相距 $k$ 的配對有 $n-k$ 對，上下三角各算一次。` },
              { tex: r`E[s^2]=\frac{1}{n-1}\Big[n\sigma^2-\frac{\sigma^2}{n}(n+2S_1)\Big]=\sigma^2\Big[1-\frac{2S_1}{n(n-1)}\Big]`, why: r`代回第一行並整理：$\bar x$「吃掉」了一部分低頻變異，正相關（$S_1>0$）時 $s^2$ 偏低。` },
              { tex: r`S_1=\frac{p\,[\,n(1-p)-(1-p^n)\,]}{(1-p)^2}\ \approx\ \frac{np}{1-p}\quad(n\gg\tfrac{1}{1-p})`, why: r`等比級數與它的導數（$\sum kp^k$）的封閉式；大 $n$ 時只留主項。` },
              { tex: r`\frac{E[s^2]}{\sigma^2}\approx1-\frac{2p}{(1-p)\,n}`, why: r`大 $n$ 近似：偏差與「相關時間／視窗長度」成正比。` },
            ])}
            result={`n=${nums.nBlk}:\\ \\ \\frac{E[s^2]}{\\sigma_w^2}=${fmtNum(nums.fVar, 6)}\\quad(\\text{偏低 }${fmtNum((1 - nums.fVar) * 100, 3)}\\%)`}
          />
          <FBlock id="F-VF.6" />
          <p className="small">
            偏低 <Tex>{`${fmtNum((1 - nums.fVar) * 100, 2)}\\%`}</Tex> 聽起來很小，但 {nums.R} 條 chain 平均後的相對 SE 也只有約 <Tex>{`${fmtNum(nums.relSe * 100, 3)}\\%`}</Tex>，
            所以不修正的話 <Tex>{'z'}</Tex> 會有 <Tex>{`${fmtNum((nums.fVar - 1) / nums.relSe, 2)}`}</Tex> 的系統性偏移——換很多個 seed 就看得出來（下方的校準實驗）。本頁的做法：期望值改成{' '}
            <Tex>{r`\sigma_w^2\cdot E[s^2]/\sigma^2`}</Tex> 再比。SE 則用 {nums.R} 條<strong>獨立</strong> chain 之間的離散程度估計，不需要知道相關結構。 <ClaimTag kind="exact" />
          </p>

          <p>
            <strong>(4) lag-1 自相關與 ENBW（T14）。</strong> 估計量 <Tex>{r`r_1=\sum c_ic_{i+1}/\sum c_i^2`}</Tex>（<Tex>{r`c_i=x_i-\bar x`}</Tex>）同樣因為扣掉樣本平均而偏低：
          </p>
          <FBlock id="F-VF.7" />
          <ModeGate min="research">
            <StepDerivation
              title={M('推導大綱：分子與分母各自的期望值（程式用的是有限 $n$ 的精確式）')}
              steps={steps([
                { tex: r`\sum_{i=1}^{n-1}c_ic_{i+1}=\sum_ix_ix_{i+1}-(n+1)\,\bar x^2+\bar x\,(x_1+x_n)`, why: r`展開 $(x_i-\bar x)(x_{i+1}-\bar x)$，用 $\sum_{i=1}^{n-1}(x_i+x_{i+1})=2n\bar x-x_1-x_n$ 合併。` },
                { tex: r`\frac{E[\mathrm{num}]}{\sigma^2}=(n-1)p-\frac{(n+1)(n+2S_1)}{n^2}+\frac{2(1-p^n)}{n(1-p)}`, why: r`逐項取期望值：$E[x_ix_{i+1}]=\sigma^2p$、$E[\bar x^2]=\sigma^2(n+2S_1)/n^2$、$E[\bar xx_1]=\sigma^2(1-p^n)/(n(1-p))$。` },
                { tex: r`\frac{E[\mathrm{den}]}{\sigma^2}=n-1-\frac{2S_1}{n}`, why: r`就是第 (3) 點的 $(n-1)E[s^2]/\sigma^2$。` },
                { tex: r`\frac{E[\mathrm{num}]}{E[\mathrm{den}]}\approx p-\frac{1+2p}{n}`, why: r`代入 $S_1\approx np/(1-p)$ 後做一階展開。` },
                { tex: r`E\Big[\frac{\mathrm{num}}{\mathrm{den}}\Big]\approx\frac{E[\mathrm{num}]}{E[\mathrm{den}]}-\frac{p}{nR}`, why: r`比值的期望值不等於期望值的比（分子分母相關）；$R$ 條 chain 的分子、分母各自相加後，這個修正縮小 $R$ 倍。$R=1$ 時合計 $-(1+3p)/n$（Kendall；Marriott–Pope）。` },
              ])}
            />
          </ModeGate>
          <p className="small">
            代入 <Tex>{`n=${nums.nBlk}`}</Tex>：單一 chain <Tex>{`E[r_1]\\approx${fmtNum(nums.pExp1, 6)}`}</Tex>、{nums.R} 條合併 <Tex>{`E[r_1]\\approx${fmtNum(nums.pExpR, 6)}`}</Tex>（真值{' '}
            <Tex>{`p=${fmtNum(nums.lp.p, 6)}`}</Tex>）；而 <Tex>{`\\mathrm{SE}(\\hat p)\\approx\\sqrt{(1-p^2)/(nR)}=${texNum(nums.seP, 3)}`}</Tex>，偏差是 SE 的{' '}
            <Tex>{`${fmtNum((nums.pExpR - nums.lp.p) / nums.seP, 2)}`}</Tex> 倍。「比值修正」<Tex>{r`-p/(nR)`}</Tex> 只是一階近似：<Tex>{'p'}</Tex> 接近 1 時，被忽略的高階項以{' '}
            <Tex>{r`1/\big(n(1-p)\big)`}</Tex> 的次方出現，單一條短 chain（<Tex>{'R=1'}</Tex>）不可忽略；合併 {nums.R} 條後它也縮小 <Tex>{'R'}</Tex> 倍，遠小於 SE（
            <code>acceptance.test.ts</code> 以 Gaussian AR(1) 的 Monte Carlo 驗證 <Tex>{'n=200'}</Tex>、<Tex>{`R=${nums.R}`}</Tex> 的情形）。ENBW 是 <Tex>{'p'}</Tex> 的函數，誤差用一階泰勒傳遞：
          </p>
          <StepDerivation
            steps={steps([
              { tex: r`\mathrm{ENBW}(p)=\frac{f_u}{2}\cdot\frac{1-p}{1+p}`, why: r`one-sided 等效雜訊頻寬（勘誤 E06）。` },
              { tex: r`\frac{d\,\mathrm{ENBW}}{dp}=\frac{f_u}{2}\cdot\frac{-(1+p)-(1-p)}{(1+p)^2}=-\frac{f_u}{(1+p)^2}`, why: r`商的微分：分子微分是 $-1$、分母微分是 $+1$。` },
              { tex: r`\mathrm{SE}(\hat p)\approx\sqrt{\frac{1-p^2}{n}}`, why: r`AR(1) 的 lag-1 自相關估計量的漸近標準誤（Bartlett；$n$ 是 chain 數乘上每條的 block 數）。` },
            ])}
          />
          <FBlock id="F-VF.8" />

          <p>
            <strong>(5) SE 是「估計」出來的：Student-<Tex>{'t'}</Tex>。</strong> T13 的 SE 來自 {nums.R} 條 chain 的樣本標準差 <Tex>{'s'}</Tex>，它自己也有誤差。這時{' '}
            <Tex>{r`t=(\hat\theta-\theta)/(s/\sqrt R)`}</Tex> 不是常態，而是自由度 <Tex>{r`\nu=R-1`}</Tex> 的 Student-<Tex>{'t'}</Tex> 分布，尾巴比較厚：
          </p>
          <div className="table-wrap">
            <table className="ver-table ver-handcalc">
              <thead>
                <tr>
                  <th>
                    自由度 <Tex>{r`\nu`}</Tex>
                  </th>
                  <th>
                    <Tex>{r`P(|t_\nu|>4)`}</Tex>
                  </th>
                  <th>是常態的幾倍</th>
                  <th>
                    <Tex>{r`t=4`}</Tex> 的等效 <Tex>{r`z_{\rm eq}`}</Tex>
                  </th>
                  <th>
                    <Tex>{r`z_{\rm eq}=4`}</Tex> 對應的 <Tex>{r`t_{\rm crit}`}</Tex>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[15, 23, 100, Infinity].map((nu) => (
                  <tr key={nu}>
                    <td>{Number.isFinite(nu) ? nu : <Tex>{r`\infty\ (\text{常態})`}</Tex>}</td>
                    <td className="num">
                      <Tex>{texNum(falseAlarmRateT(4, nu), 3)}</Tex>
                    </td>
                    <td className="num">{fmtNum(falseAlarmRateT(4, nu) / a4, 3)}</td>
                    <td className="num">{fmtNum(equivalentZ(4, nu), 4)}</td>
                    <td className="num">{fmtNum(tCritical(4, nu), 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">
            若直接拿 <Tex>{'t'}</Tex> 和 <Tex>{r`z_{\rm crit}=4`}</Tex> 比，<Tex>{r`\nu=23`}</Tex> 的誤報率會是你以為的 {fmtNum(falseAlarmRateT(4, 23) / a4, 2)} 倍。所以本頁把 <Tex>{'t'}</Tex>{' '}
            換成<strong>尾機率相同</strong>的常態分數再比，讓每一列的門檻代表同一個誤報率（等價的說法：SE 是估計值時，門檻要從 4 放寬到上表最右欄的{' '}
            <Tex>{r`t_{\rm crit}`}</Tex> 個「估計的 SE」）：
          </p>
          <FBlock id="F-VF.5" />
          <CodeBlock
            source={acceptanceSrc}
            region="equivalentZ"
            path="src/simulation/models/acceptance.ts"
            title="core:equivalentZ（F-VF.5；T12、T13 的 SE 由 chain 估計）"
            caption="$\nu=\infty$（T04、T05、T17：SE 由期望值的參數直接算出）時原樣回傳 $t$。"
          />
          <CodeBlock
            source={acceptanceSrc}
            region="zCheck"
            path="src/simulation/models/acceptance.ts"
            title="core:zCheck（每一項統計檢查共用的判定）"
            caption="agree：$|z|\le z_{\rm crit}$ 通過；reject（反面項目）：$|z|>z_{\rm crit}$ 才通過。"
          />
          <CodeBlock
            source={acceptanceSrc}
            region="ar1SampleBias"
            path="src/simulation/models/acceptance.ts"
            title="core:ar1SampleBias（第 3、4 點的偏差修正；F-VF.6 / F-VF.7）"
            caption="acceptance.test.ts 以共變異矩陣暴力計算 $\operatorname{tr}(\cdot)$ 驗證這三個封閉式（$n=7$）。"
          />
        </Expand>
      </ModeGate>
    </>
  )
}
