import { useMemo } from 'react'
import { Callout, ClaimTag, Section, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import { DEFAULT_STRUCTURE, eig2, modeAnalysis, uniformMomentMatrix } from '@/simulation/models/dtcInl'
import { BasisLab } from '../experiments/BasisLab'
import { m, num, texNum } from '../common'
import { F } from '../formulas'
import { Hand } from '../Hand'

/** §11b.3c 條件數與 preconditioning：Hankel vs Legendre、HC-11B.4、F-11B.14、實驗 C。 */
export function BasisSection() {
  const t = useMemo(() => {
    const mono = modeAnalysis(uniformMomentMatrix({ ...DEFAULT_STRUCTURE, structure: 'poly', M: 3, basis: 'monomial' }), 1, 1, 64)
    const cheb = modeAnalysis(uniformMomentMatrix({ ...DEFAULT_STRUCTURE, structure: 'poly', M: 3, basis: 'chebyshev' }), 1, 1, 64)
    const [eh, el] = eig2(1, 1 / 3, 1 / 5)
    const [oh, ol] = eig2(1 / 3, 1 / 5, 1 / 7)
    return { mono, cheb, eh, el, oh, ol }
  }, [])

  return (
    <Section kind="formula" title="11b.3c 條件數與 preconditioning：同一個函數空間，換基底就快十倍" level={2} id="ch11b-basis">
      <p>
        <ChRef ch="10">Ch10</ChRef> 說 scalar <Tex>{'\\mu'}</Tex> 下最慢與最快模式的時間常數比就是條件數 <Tex>{'\\kappa=\\lambda_{\\max}/\\lambda_{\\min}'}</Tex>（F-10.5），而 preconditioner <Tex>{'\\mathbf M=\\gamma(K_q\\mathbf R)^{-1}'}</Tex> 把所有 pole 變成 <Tex>{'1-\\gamma'}</Tex>（F-10.4）。多項式 INL 校正是這件事最乾淨的例子：<strong>同一個函數空間</strong>（三次多項式）可以用 <Tex>{'\\{1,x,x^2,x^3\\}'}</Tex> 展開，也可以用 Legendre <Tex>{'\\{P_0,P_1,P_2,P_3\\}'}</Tex> 展開——最佳的 <Tex>{'c(x)'}</Tex> 一模一樣，LMS 的速度卻差一個量級。
      </p>
      <StepDerivation
        title={m('monomial 的 Hankel 矩陣：偶／奇分塊各自 2×2')}
        steps={[
          { tex: String.raw`R_{mn}=E[x^{m+n}]=\begin{cases}\dfrac{1}{m+n+1}&m+n\text{ 偶}\\[0.6em]0&m+n\text{ 奇}\end{cases}\qquad(x\sim U(-1,1))`, why: m('$\\int_{-1}^1x^{k}dx/2=1/(k+1)$（偶）、0（奇）。奇次動差為 0 讓 $\\{1,x^2\\}$ 與 $\\{x,x^3\\}$ 解耦。') },
          { tex: String.raw`\text{偶：}\begin{bmatrix}1&\tfrac13\\\tfrac13&\tfrac15\end{bmatrix}\Rightarrow\lambda=${texNum(t.eh, 4)},\ ${texNum(t.el, 4)};\qquad\text{奇：}\begin{bmatrix}\tfrac13&\tfrac15\\\tfrac15&\tfrac17\end{bmatrix}\Rightarrow\lambda=${texNum(t.oh, 4)},\ ${texNum(t.ol, 4)}`, why: m('2×2 的特徵值 $(\\operatorname{tr}\\pm\\sqrt{\\operatorname{tr}^2-4\\det})/2$（HC-11B.4）。奇分塊的 $\\det=\\tfrac1{21}-\\tfrac1{25}$ 非常小：$x^3$ 幾乎是 $x$ 的倍數。') },
          { tex: String.raw`\kappa=\frac{${texNum(t.eh, 4)}}{${texNum(t.ol, 4)}}=${texNum(t.mono.cond, 4)}`, why: m('最慢的模式是「$x^3$ 減掉它在 $x$ 上的投影」那個方向，regressor 功率只有 $${texNum(t.ol, 4)}$。') },
          { tex: String.raw`\text{Legendre：}E[P_mP_n]=\frac{\delta_{mn}}{2m+1}\Rightarrow\mathbf R=\operatorname{diag}(1,\tfrac13,\tfrac15,\tfrac17),\ \kappa=7;\qquad\sqrt{2m+1}P_m\Rightarrow\mathbf R=\mathbf I,\ \kappa=1`, why: m('正交多項式就是「對這個分布先做好 preconditioning」的基底：$P_3=\\tfrac12(5x^3-3x)$ 已經把 $x^3$ 裡的 $x$ 減掉了。Chebyshev 對 uniform 權重不正交（$\\kappa=${texNum(t.cheb.cond, 3)}$），但比 monomial 好得多。') },
        ]}
      />
      <TexBlock id="F-11B.14" label={m('preconditioner：完整與對角')}>
        {F.precond}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="exact" /> {m('$\\hat{\\mathbf R}=\\mathbf R$ 時精確；實際上 $\\mathbf R$ 要用已知的 code 分布算（uniform 的 Hankel 是封閉式，MASH 要從樣本估）。弱方向的 $\\gamma/\\lambda_i$ 很大，雜訊跟著放大（Ch10 F-10.6）。')}
      </p>
      <Callout kind="info" title="三種「讓它快」的方法，其實是同一件事">
        <ul>
          <li>{m('換正交基底（Legendre）：離線把 $\\mathbf R$ 對角化，硬體是遞迴產生 $P_m(x)$（每階約 2 個乘法器）。')}</li>
          <li>{m('對角 preconditioner：每個參數自己的 $\\mu_i=\\gamma/(K_qR_{ii})$——分段／LUT 的 $\\mathbf R$ 本來就對角，這就是「每段自己的 $\\mu_k\\propto1/\\lambda_k$」，幾個移位器就夠。')}</li>
          <li>{m('完整 preconditioner：$\\mathbf M\\propto\\mathbf R^{-1}$，$P\\times P$ 的矩陣乘法；$P=4$ 還可以，$P=64$（LUT）沒必要——它已經對角了。')}</li>
        </ul>
        <p>{m(`Monomial 的 $\\kappa=${num(t.mono.cond, 4)}$ 隨 $M$ 指數成長（Hilbert 矩陣），$M=5$ 約 $1.9\\times10^3$、$M=6$ 破萬；Legendre 的 $2M+1$ 只是線性。這就是為什麼多項式校正在硬體上幾乎都用正交基底或分段。`)}</p>
      </Callout>
      <Hand id="HC-11B.4">{m('換動差 $m_2$、$m_4$、$m_6$（例如 MASH 的樣本動差），用 2×2 分塊算條件數。')}</Hand>
      <BasisLab />
      <Callout kind="ok" title="試試看">
        <ol>
          <li>{m('預設（uniform、$M=3$、$g_{\\max}=0.1$）：四條曲線終點相同（floor $=0$），monomial 的 $k_{95}\\approx560$ blocks、Legendre 131、normalized 29（$\\ln20/0.1$）。條件數 67.6、7、1、5.9。')}</li>
          <li>{m('preconditioner 改 full、$\\gamma=0.1$：四條曲線重合（所有 pole 都是 0.9）——基底不再重要。改 diag：Legendre／normalized 幾乎不變（本來就對角），monomial 只改善一部分。')}</li>
          <li>{m('code 改 MASH：Legendre 不再精確對角（MASH 不是 uniform），條件數變成十幾；normalized 也不是 1。實際晶片要用實際 code 的 $\\mathbf R$。')}</li>
          <li>{m('$M=6$：monomial 的 $\\kappa$ 破萬（$M=5$ 約 $1.9\\times10^3$），mean-field 的 $k_{95}$ 超過模擬長度（警告）；Legendre 仍是 $2M+1=13$。')}</li>
        </ol>
      </Callout>
    </Section>
  )
}
