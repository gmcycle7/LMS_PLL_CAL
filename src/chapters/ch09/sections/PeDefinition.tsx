import { useMemo } from 'react'
import { Callout, ClaimTag, Prereq, Section, StepDerivation, TexBlock, ChRef } from '@/components'
import { eig2x2, pm1DegenerateProb, sampleEigRelStd, slidingWindowPe } from '@/simulation/models/pe'
import { DerivBox, Diagram, FigRef, HandCalcBox, formulaTex, m, num, texMatrix, texNum } from '../shared'

/** 「先算一次」的兩個 N₀ = 4 窗口（±1 code；輸入是例子，S_k 與 eigenvalues 由程式計算） */
const HAND_WINDOWS: { name: string; u: [number, number][] }[] = [
  { name: 'A', u: [[1, 1], [-1, -1], [1, 1], [-1, -1]] },
  { name: 'B', u: [[1, 1], [1, -1], [-1, -1], [1, 1]] },
]

/** §9.1 Persistent Excitation 的有限窗口定義、滑動窗口 R_k、λ_min、κ、singular values。 */
export function PeDefinition() {
  const deg = useMemo(() => [10, 50, 100, 300, 1000].map((N0) => ({ N0, p: pm1DegenerateProb(0.99, N0) })), [])
  const hand = useMemo(
    () =>
      HAND_WINDOWS.map((w) => {
        const S = [
          [0, 0],
          [0, 0],
        ]
        for (const [a, b] of w.u) {
          S[0][0] += a * a
          S[0][1] += a * b
          S[1][0] += b * a
          S[1][1] += b * b
        }
        const eig = eig2x2(S[0][0], S[0][1], S[1][1]).values
        // 同一個窗口用行為模型的 slidingWindowPe 再算一次（R_k = S_k/N₀）
        const pe = slidingWindowPe(
          w.u.map((r) => r[0]),
          w.u.map((r) => r[1]),
          w.u.length,
        )
        return { ...w, S, eig, lminR: pe.lmin[0], kappa: pe.kappa[0] }
      }),
    [],
  )
  return (
    <Section kind="formula" title="§9.1 Persistent Excitation：每一個方向、每一段時間都要被推到" level={2} id="ch09-pe">
      <p>
        前兩節用的是 {m`\mathbf R=E[\mathbf u\mathbf u^T]`}——一個「無限長平均」。硬體只會看到有限長的資料，而且 DSM / FCW 產生的 code
        常常是 deterministic、週期性的。所以 PE 的嚴格定義是對 <strong>每一個有限窗口</strong> 說話。檢查的流程如下圖：
      </p>
      <Diagram id="pe-window">
        看藍色的判斷：不是「平均起來有能量」就好，而是<strong>每一個</strong>起點 {m`k`} 的窗口都要通過。
      </Diagram>
      <p>
        <FigRef id="pe-window" /> 怎麼看：先看前幾個方塊——取連續 {m`N_0`} 筆 regressor（{m`N_0`} 是<strong>窗口長度</strong>；它和 GMAC 的 block 長度 {m`N`}
        是兩個不同的量），每一筆做外積 {m`\mathbf u\mathbf u^T`}，全部加起來得到<strong>窗口能量矩陣</strong> {m`\mathbf S_k`}（這裡的下標 {m`k`} 是窗口的起點）；
        除以 {m`N_0`} 就是這個窗口自己的相關矩陣 {m`\mathbf R_k`}。再看 eigenvalues——{m`\lambda_{\min}(\mathbf R_k)`} 是這個窗口裡「最弱的方向」的能量，
        {m`\lambda_{\max}(\mathbf R_k)`} 是最強的方向。最後看藍色的判斷——PE 要求存在兩個固定的正數 {m`\alpha`}（下界）與 {m`\beta`}（上界），讓每一個窗口最弱的方向
        至少有 {m`\alpha`}、最強的方向不超過 {m`\beta`}；通過之後窗口往後滑一格再檢查，永遠都要通過。圖上的「滑動窗口相加」就是下面 F-09.9 中間那個
        {m`\sum`}；藍色菱形就是 F-09.9 的兩個不等號（因為 {m`\lambda(\mathbf S_k)=N_0\lambda(\mathbf R_k)`}，圖上寫成 {m`N_0\lambda_{\min}(\mathbf R_k)\ge\alpha`}）；
        圖上的 {m`R_k`}、{m`\kappa(R_k)`}、{m`\sigma_i(U_k)`} 就是 F-09.10 的三個量。
      </p>
      <p>先用兩個只有 4 筆資料的小窗口感覺一下：</p>

      <h3>先算一次：兩個 {m`N_0=4`} 的窗口</h3>
      <p>
        把窗口內每一筆 {m`\mathbf u[n]\mathbf u^T[n]`}（{m`2\times2`} 的表）加起來，得到<strong>窗口能量矩陣</strong> {m`\mathbf S_k=\sum_n\mathbf u[n]\mathbf u^T[n]`}。
        例如 {m`\mathbf u=(1,-1)`} 貢獻 {m`\begin{bmatrix}1&-1\\-1&1\end{bmatrix}`}。下表的 {m`\mathbf S_k`} 與 eigenvalues 由 <code>eig2x2</code> /{' '}
        <code>slidingWindowPe</code> 計算：
      </p>
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th className="ch09-left">窗口</th>
              <th className="ch09-left">{m`\mathbf u[k],\dots,\mathbf u[k+3]`}</th>
              <th>{m`\mathbf S_k`}</th>
              <th>{m`\lambda(\mathbf S_k)`}</th>
              <th>{m`\lambda_{\min}(\mathbf R_k)`}</th>
              <th>{m`\kappa(\mathbf R_k)`}</th>
              <th className="ch09-left">結論</th>
            </tr>
          </thead>
          <tbody>
            {hand.map((w) => (
              <tr key={w.name}>
                <td className="ch09-left">{w.name}</td>
                <td className="ch09-left nowrap">{m`${w.u.map((r) => `(${r[0]},${r[1]})`).join(',\\ ')}`}</td>
                <td>{m`${texMatrix(w.S)}`}</td>
                <td className="nowrap">
                  {num(w.eig[0])}、{num(w.eig[1])}
                </td>
                <td>{num(w.lminR)}</td>
                <td>{num(w.kappa)}</td>
                <td className="ch09-left">
                  {w.eig[1] > 0 ? (
                    <>兩個方向都有能量：這個窗口的 {m`\alpha`} 可取到 {m`${texNum(w.eig[1])}`}</>
                  ) : (
                    <>
                      <span className="ch09-bad">退化</span>：四筆全是 {m`u_1=u_2`}，差模方向 {m`(1,-1)`} 的能量是 0，找不到 {m`\alpha>0`}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        窗口 A 再長也沒用（只要一直是 {m`u_1=u_2`}）；窗口 B 只多了<strong>一筆</strong> {m`(1,-1)`}，{m`\lambda_{\min}`} 就從 0 變成正數。
        PE 的定義就是把「每一個窗口都至少像 B，不可以像 A」寫成不等式： <ClaimTag kind="exact" />
      </p>
      <TexBlock id="F-09.9">{formulaTex('F-09.9')}</TexBlock>
      <p>
        讀法：存在一個窗口長度 {m`N_0`} 和兩個正數 {m`\alpha,\beta`}，使得<strong>不管窗口從哪個時刻 {m`k`} 開始</strong>，窗口能量矩陣 {m`\mathbf S_k`} 在每個方向上的能量都
        介於 {m`\alpha`} 與 {m`\beta`} 之間（{m`\preceq`} 的意思見下面的先備知識框）。上表的窗口 B 單獨來看 {m`\alpha=${texNum(hand[1].eig[1])}`}、{m`\beta=${texNum(hand[1].eig[0])}`} 就夠；窗口 A 則讓任何
        {m`\alpha>0`} 都不成立。
      </p>

      <Prereq title={String.raw`記號 $\mathbf A\preceq\mathbf B$（Loewner order）與 Rayleigh quotient`}>
        <p>
          {m`\mathbf A\preceq\mathbf B`} 的意思是 {m`\mathbf B-\mathbf A`} 半正定：對所有 {m`\mathbf v`}，{m`\mathbf v^T\mathbf A\mathbf v\le\mathbf v^T\mathbf B\mathbf v`}。
          搭配 Rayleigh quotient：
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`\mathbf v=\sum_ic_i\mathbf v_i\ \Rightarrow\ \mathbf v^T\mathbf S\mathbf v=\sum_i\lambda_i(\mathbf S)\,c_i^2,\quad \|\mathbf v\|^2=\sum_ic_i^2`, why: <>用 {m`\mathbf S`} 的單位 eigenvectors 展開 {m`\mathbf v`}（{m`\mathbf S`} 對稱 {m`\Rightarrow`} eigenvectors 互相垂直）。</> },
            { tex: String.raw`\lambda_{\min}\sum_ic_i^2\le\sum_i\lambda_ic_i^2\le\lambda_{\max}\sum_ic_i^2`, why: <>每個 {m`\lambda_i`} 都介於 {m`\lambda_{\min}`} 與 {m`\lambda_{\max}`} 之間，而 {m`c_i^2\ge0`}。</> },
            { tex: String.raw`\lambda_{\min}(\mathbf S)=\min_{\mathbf v\ne0}\frac{\mathbf v^T\mathbf S\mathbf v}{\mathbf v^T\mathbf v},\qquad \lambda_{\max}(\mathbf S)=\max_{\mathbf v\ne0}\frac{\mathbf v^T\mathbf S\mathbf v}{\mathbf v^T\mathbf v}`, why: <>兩邊除以 {m`\|\mathbf v\|^2`}；取 {m`\mathbf v`} = 對應的 eigenvector 時等號成立。</> },
          ]}
        />
      </Prereq>

      <DerivBox title="把 PE 的下界翻成白話">
        <StepDerivation
          steps={[
            { tex: String.raw`\alpha\mathbf I\preceq\mathbf S_k:=\sum_{n=k}^{k+N_0-1}\mathbf u[n]\mathbf u^T[n]`, why: <>PE 下界（窗口能量矩陣 {m`\mathbf S_k`}）。</> },
            { tex: String.raw`\iff\ \mathbf v^T\mathbf S_k\mathbf v=\sum_{n=k}^{k+N_0-1}\big(\mathbf v^T\mathbf u[n]\big)^2\ \ge\ \alpha\|\mathbf v\|^2\quad\forall\mathbf v`, why: <>Loewner order 的定義；{m`\mathbf v^T\mathbf u\mathbf u^T\mathbf v=(\mathbf v^T\mathbf u)^2`}。</> },
            { tex: String.raw`\iff\ \lambda_{\min}(\mathbf S_k)\ge\alpha`, why: 'Rayleigh quotient（上方先備知識）。' },
          ]}
        />
        <p>
          白話：<strong>任何一個參數方向 {m`\mathbf v`}，在任何一個長度 {m`N_0`} 的窗口裡，regressor 投影到 {m`\mathbf v`} 上的能量都至少有 {m`\alpha`}</strong>。
          上界 {m`\beta`} 則保證能量有限，使得存在不會發散的 {m`\mu`}（例如 {m`\mu<2N_0/\beta`}）。
        </p>
      </DerivBox>

      <h3>為什麼 PE 夠用：一個窗口的收縮界</h3>
      <p>
        最簡單的情形：GMAC block 剛好等於一個窗口（{m`N=N_0`}）、linear detector、無雜訊。一個 block 的更新是
        {m`\boldsymbol\delta_{k+1}=(\mathbf I-\mu\mathbf R_k)\boldsymbol\delta_k`}，{m`\mathbf R_k=\mathbf S_k/N_0`}：
      </p>
      <Diagram id="pe-contraction">
        看每一個箭頭上的倍數：只要每個窗口都滿足 PE，誤差的長度每個 block 都至少縮小同一個比例。
      </Diagram>
      <p>
        <FigRef id="pe-contraction" /> 怎麼看：先看每一個箭頭——經過一個窗口（也就是一個 block），誤差向量的長度 {m`\|\boldsymbol\delta\|`}
        至多乘上 {m`1-\mu\lambda_{\min}(\mathbf R_k)`}。再看藍色方塊——PE 保證每個窗口的 {m`\lambda_{\min}(\mathbf R_k)`} 都不小於 {m`\alpha/N_0`}，
        所以每個箭頭都至少縮小同一個比例；{m`K`} 個窗口連乘（{m`K`} 是經過的窗口數），就是綠色方塊的指數收斂。圖上箭頭的倍數就是 F-09.17 的
        {m`\big(1-\mu\lambda_{\min}(\mathbf R_k)\big)`}，綠色方塊就是下面推導的最後一行。
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`\|\boldsymbol\delta_{k+1}\|\le\max_i|1-\mu\lambda_i(\mathbf R_k)|\cdot\|\boldsymbol\delta_k\|`, why: <>對稱矩陣作用在向量上，最多放大 {m`\max_i|\text{eigenvalue}_i|`} 倍；{m`\mathbf I-\mu\mathbf R_k`} 的 eigenvalues 是 {m`1-\mu\lambda_i(\mathbf R_k)`}。</> },
          { tex: String.raw`0\le\mu\lambda_i\le1\ \Rightarrow\ |1-\mu\lambda_i|=1-\mu\lambda_i\le1-\mu\lambda_{\min}(\mathbf R_k)`, why: <>若 {m`\mu\lambda_{\max}\le1`}，每個因子都在 {m`[0,1]`}，最大的是 {m`\lambda_{\min}`} 那一個。</> },
          { tex: String.raw`\lambda_{\min}(\mathbf R_k)\ge\alpha/N_0\ \Rightarrow\ \|\boldsymbol\delta_K\|\le\big(1-\mu\alpha/N_0\big)^K\|\boldsymbol\delta_0\|`, why: <>PE 下界對每個窗口都成立（{m`\mathbf R_k=\mathbf S_k/N_0\succeq(\alpha/N_0)\mathbf I`}）{m`\Rightarrow`} 每個 block 至少縮小同一個比例，連乘 {m`K`} 次。</> },
        ]}
      />
      <TexBlock id="F-09.17">{formulaTex('F-09.17')}</TexBlock>
      <p>
        這是 deterministic 的保證（不必假設 {m`\mathbf u`} 是隨機的）。 <ClaimTag kind="exact" /> per-sample（{m`N=1`}）LMS 在 PE 下、{m`\mu`} 夠小時也指數收斂，
        這是文獻上的經典結果（Anderson 1977；Bitmead &amp; Anderson 1980），本站未重新證明。 <ClaimTag kind="research" />
      </p>

      <h3>
        行為模型輸出：滑動窗口 {m`\mathbf R_k`}、{m`\lambda_{\min}`}、{m`\kappa`} 與 singular values
      </h3>
      <p>
        行為模型對每個窗口輸出三個數：{m`\lambda_{\min}(\mathbf R_k)`}、{m`\kappa(\mathbf R_k)`}，以及<strong>資料矩陣</strong> {m`\mathbf U_k`} 的 singular values
        {m`\sigma_i(\mathbf U_k)`}。{m`\mathbf U_k`} 是把窗口內 {m`N_0`} 筆 regressor 一列一列疊起來的 {m`N_0\times M`} 矩陣；singular value 是它把向量
        「放大幾倍」（先備知識框）。這三個數就是 <FigRef id="pe-window" /> 裡 eigenvalues 與 {m`\kappa`} 那兩個方塊的輸出：
      </p>
      <TexBlock id="F-09.10">{formulaTex('F-09.10')}</TexBlock>
      <DerivBox title={<>為什麼 {m`\sigma_i(\mathbf U_k)^2=N_0\lambda_i(\mathbf R_k)`}</>}>
        <StepDerivation
          steps={[
            { tex: String.raw`\mathbf U_k=\begin{bmatrix}\mathbf u^T[k]\\\vdots\\\mathbf u^T[k+N_0-1]\end{bmatrix}\in\mathbb R^{N_0\times M}`, why: '把窗口內的 regressor 一列一列疊起來（資料矩陣）。' },
            { tex: String.raw`\mathbf U_k^T\mathbf U_k=\sum_n\mathbf u[n]\mathbf u^T[n]=N_0\mathbf R_k`, why: <>矩陣乘法：第 {m`(i,j)`} 項 {m`=\sum_nu_i[n]\,u_j[n]`}。</> },
            { tex: String.raw`\sigma_i(\mathbf U_k)^2=\lambda_i(\mathbf U_k^T\mathbf U_k)=\lambda_i(N_0\mathbf R_k)`, why: <>singular value 的定義（先備知識框）：{m`\sigma_i(\mathbf A)=\sqrt{\lambda_i(\mathbf A^T\mathbf A)}`}，再代入上一步。</> },
            { tex: String.raw`(N_0\mathbf R_k)\mathbf v=N_0(\mathbf R_k\mathbf v)=N_0\lambda_i\mathbf v\ \Rightarrow\ \lambda_i(N_0\mathbf R_k)=N_0\,\lambda_i(\mathbf R_k)`, why: <>矩陣乘上常數 {m`N_0`}：eigenvector 不變，eigenvalue 乘 {m`N_0`}。</> },
            { tex: String.raw`\sigma_i(\mathbf U_k)=\sqrt{N_0\,\lambda_i(\mathbf R_k)}`, why: <>開根號。（等價的說法：SVD {m`\mathbf U_k=\mathbf W\boldsymbol\Sigma\mathbf V^T\ \Rightarrow\ \mathbf U_k^T\mathbf U_k=\mathbf V\boldsymbol\Sigma^2\mathbf V^T`}。）</> },
          ]}
        />
      </DerivBox>
      <p>
        所以 {m`\lambda_{\min}(\mathbf R_k)`}、{m`\kappa(\mathbf R_k)`} 與資料矩陣的 singular values 是同一件事的三種說法：
        {m`\lambda_{\min}`} 小 = 某個方向的能量少 = 該方向學得慢；{m`\lambda_{\min}=0`}（{m`\sigma_{\min}(\mathbf U_k)=0`}）= 該窗口內完全沒有那個方向的資訊。
        另外 {m`\mathrm{rank}(\mathbf U_k)\le N_0`}：{m`N_0<M`} 的窗口必定退化。 <ClaimTag kind="exact" />
      </p>
      <HandCalcBox id="HC-09.6">
        自己編四筆 regressor（{m`\pm1`} 或任何數字），先手算窗口能量矩陣 {m`\mathbf S_k`} 的三個元素，再求它的 eigenvalues、{m`\kappa`} 與
        {m`\sigma_{\min}(\mathbf U_k)`}。範例是上面的窗口 B；把它改成窗口 A，看 {m`\lambda_{\min}`} 怎麼變成 0。
      </HandCalcBox>

      <Callout kind="warn" title={String.raw`有限窗口的陷阱：量過幾段時間 $\ne$ 證明了 PE`}>
        <p>
          只量某一段時間的 {m`\lambda_{\min}(\mathbf R_k)`}，<strong>不能</strong>證明所有未來窗口都滿足 PE。對隨機 code 甚至一定會出現壞窗口。
          例：{m`\pm1`} sparse-flip code（{m`u_2=s\,u_1`}，{m`P(s=+1)=(1+\rho)/2`}）的窗口退化 {m`\iff`} 窗口內 {m`s`} 全同號（就像上面的窗口 A）；
          {m`N_0`} 筆獨立樣本全為 {m`+1`} 的機率是 {m`\big(\tfrac{1+\rho}2\big)^{N_0}`}，全為 {m`-1`} 是 {m`\big(\tfrac{1-\rho}2\big)^{N_0}`}，兩者相加。先看這個窗口的 {m`\mathbf S_k`} 長什麼樣子：
        </p>
        <Diagram id="pm1-degenerate">
          看紅色與綠色兩個方塊：窗口只在 {m`s`} 全同號時退化，但 {m`\rho`} 越接近 1，全同號的機率就越高。
        </Diagram>
        <p>
          <FigRef id="pm1-degenerate" /> 怎麼看：先看窗口的 {m`\mathbf S_k`}——{m`\pm1`} code 每一筆的 {m`\mathbf u\mathbf u^T`} 都是 {m`\begin{bmatrix}1&s\\s&1\end{bmatrix}`}，
          所以整個窗口只由 {m`s=+1`} 的個數 {m`N_{+}`} 與 {m`s=-1`} 的個數 {m`N_{-}`}（{m`N_{+}+N_{-}=N_0`}）決定：對角線都是 {m`N_0`}，非對角線是 {m`N_{+}-N_{-}`}，eigenvalues 是 {m`N_0\pm|N_{+}-N_{-}|`}。
          再看菱形——只有 {m`N_{+}=0`} 或 {m`N_{-}=0`}（{m`s`} 全同號）時 {m`\lambda_{\min}(\mathbf S_k)=N_0-|N_{+}-N_{-}|=2\min(N_{+},N_{-})`} 才是 0，這就是上面的窗口 A；
          其他窗口至少有 2。圖上紅色方塊的機率就是下面 F-09.11：全為 {m`+1`} 加上全為 {m`-1`}。
        </p>
        <TexBlock id="F-09.11">{formulaTex('F-09.11')}</TexBlock>
        <div className="table-wrap">
          <table className="ch09-table">
            <thead>
              <tr>
                <th>{m`N_0`}</th>
                {deg.map((d) => (
                  <th key={d.N0}>{d.N0}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>退化窗口比例（{m`\rho=0.99`}）</td>
                {deg.map((d) => (
                  <td key={d.N0}>{num(100 * d.p, 4)}%</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          {m`N_0=100`} 時超過六成的窗口對差模<strong>完全沒有資訊</strong>，雖然長期平均 {m`\lambda_{\min}(\mathbf R)=0.01>0`}。 <ClaimTag kind="exact" />
        </p>
      </Callout>
      <Prereq title={String.raw`變異數、標準差與「平均 $N$ 筆 $\Rightarrow$ 誤差 $\propto1/\sqrt N$」`}>
        <p>
          變異數（variance）{m`\mathrm{Var}(X)=E[(X-E[X])^2]`} 量「離平均多遠」；標準差 {m`\mathrm{std}=\sqrt{\mathrm{Var}}`} 與 {m`X`} 同單位。
          {m`N`} 筆獨立、同分布樣本的平均 {m`\bar X=\tfrac1N\sum X_n`}：
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`\mathrm{Var}(\bar X)=\frac1{N^2}\sum_n\mathrm{Var}(X_n)`, why: <>獨立 {m`\Rightarrow`} 和的變異數 = 變異數的和；常數 {m`1/N`} 平方後提出。</> },
            { tex: String.raw`=\frac{N\,\mathrm{Var}(X)}{N^2}=\frac{\mathrm{Var}(X)}{N}\ \Rightarrow\ \mathrm{std}(\bar X)=\frac{\mathrm{std}(X)}{\sqrt N}`, why: '同分布。' },
          ]}
        />
        <p>
          窗口相關矩陣 {m`\mathbf R_k`} 的每一項都是 {m`N_0`} 筆乘積的平均，所以它的估計誤差也以 {m`1/\sqrt{N_0}`} 縮小；eigenvalue 也一樣（下式）。
        </p>
      </Prereq>
      <p>
        Gaussian regressor 不會精確退化（{m`N_0\ge2`} 時幾乎必然滿秩），但窗口估計有散佈。{m`\lambda_i`} 互異且 {m`N_0\gg1`} 時：
      </p>
      <TexBlock id="F-09.12">{formulaTex('F-09.12')}</TexBlock>
      <p>
        例如 {m`N_0=100`} 時約 {m`\pm${texNum(100 * sampleEigRelStd(100), 3)}\%`}；要把 {m`\lambda_{\min}=0.01`} 量到 {m`\pm1\%`} 需要 {m`N_0\approx2\times10^4`}。 <ClaimTag kind="approx" />
      </p>
      <Callout kind="info" title="連結到 PLL">
        Near-integer FCW 讓 DSM residue 變成週期很長、近乎常數的序列；多段 DTC gain / INL 係數若由同一個 code 的不同函數驅動，
        其 regressor 往往高度相關（{m`\rho\to1`}）。這時 calibration 迴路穩定，但某些組合（差模）幾乎不動。對策是改善激發（code randomization、
        dither、training sequence；規格附錄 R5），或改用 preconditioner（<ChRef ch="10">第 10 章</ChRef>）。
      </Callout>
    </Section>
  )
}
